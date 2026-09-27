#!/usr/bin/env node
// Live verification of the deployed GitHub connector (opt-in; never CI).
//
//   LIVE_URL=https://<your-render-url> LIVE_REPO=<owner/name> node scripts/live-verify.mjs
//
// What it does, against the DEPLOYED app and the ONE repository you name:
//   * finds the tenant that connected the live installation, allowlists ONLY that repository (if not already),
//     creates a fixture agent/task/contract/runtime key and binds the task to it (same rows the UI writes);
//   * drives the agent workflow over real HTTP: authorize -> execute (read, branch, file, DRAFT PR, read back),
//     idempotent repeats, guardrails, replay;
//   * independently confirms the results with read-only `gh api` GETs on that repository (default branch unchanged,
//     PR is a draft and NOT merged);
//   * checks receipts and that no GitHub token shape was persisted.
// It never merges anything, never modifies repository settings, never contacts any other repository, and never
// prints a secret (the fixture runtime key lives only in this process's memory).

import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(path.join(root, ".supabase-cli.env"));

const LIVE_URL = (process.env.LIVE_URL ?? "").replace(/\/+$/, "");
const REPO = process.env.LIVE_REPO ?? "rishit2121/authority-github-test";
const EXPECT_MODE = process.env.EXPECT_MODE ?? "live"; // "mock" only for a local self-test
if (!/^https?:\/\//.test(LIVE_URL) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(REPO)) {
  console.error("Set LIVE_URL (deployed origin) and LIVE_REPO (owner/name).");
  process.exit(2);
}
const [OWNER, NAME] = REPO.split("/");
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error("SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF missing (.supabase-cli.env).");
  process.exit(2);
}

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
};

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sql failed: ${String(body.message ?? "").slice(0, 200)}`);
  return body;
}

// Read-only GitHub verification through the operator's own gh login, restricted to the one repository.
function gh(apiPath) {
  if (!apiPath.startsWith(`repos/${OWNER}/${NAME}`))
    throw new Error("refusing to query any other repository");
  return JSON.parse(
    execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", apiPath], { encoding: "utf8" }),
  );
}

const versions = () => {
  const registry = /registryVersion:\s*"([^"]+)"/.exec(
    readFileSync(path.join(root, "src/lib/registry/fixtures/github-demo.ts"), "utf8"),
  )[1];
  const compiler = /COMPILER_VERSION\s*=\s*"([^"]+)"/.exec(
    readFileSync(path.join(root, "src/lib/authorization/contract-compiler.ts"), "utf8"),
  )[1];
  return { registry, compiler };
};

let secret = "";
async function api(method, url, body, bearer = secret) {
  const res = await fetch(`${LIVE_URL}${url}`, {
    method,
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000), // a sleeping free-tier instance can take a minute to wake
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body: json };
}

const uid = () => crypto.randomUUID();
const RUN = Date.now().toString(36);

async function main() {
  console.log(`Live verification of ${LIVE_URL} against ${REPO} (expecting ${EXPECT_MODE} mode)\n`);

  // 0. Deployment readiness.
  const ready = await api("GET", "/api/v1/ready", null, "");
  check(
    ready.status === 200 && ready.body?.tls === "verified",
    "deployment is ready with a verified database certificate",
    JSON.stringify(ready.body),
  );
  check(
    ready.body?.github === EXPECT_MODE,
    `GitHub connector reports mode "${EXPECT_MODE}"`,
    String(ready.body?.github),
  );

  // 1. The installation someone connected through the UI.
  const inst = await sql(`
    select gi.id, gi.tenant_id, gi.github_installation_id, gi.mode, gi.status, gi.granted_permissions, gi.health_reasons, r.id as repo_id, r.allowed, r.present
    from public.github_installations gi
    join public.github_repositories r on r.installation_row_id = gi.id and r.tenant_id = gi.tenant_id
    where gi.status <> 'disconnected' and lower(r.owner || '/' || r.name) = lower('${REPO}')`);
  if (
    !check(
      inst.length === 1,
      "an installation exists that includes the test repository",
      `${inst.length} found`,
    )
  ) {
    console.log("\nConnect GitHub in the app first (Integrations → GitHub → Connect GitHub).");
    return;
  }
  const i = inst[0];
  check(i.mode === EXPECT_MODE, `installation mode is ${EXPECT_MODE}`, i.mode);
  check(
    i.status === "active",
    "installation is active (no drift/suspension)",
    `${i.status} ${JSON.stringify(i.health_reasons)}`,
  );
  const perms = JSON.stringify(Object.entries(i.granted_permissions).sort());
  check(
    perms ===
      JSON.stringify([
        ["contents", "write"],
        ["issues", "read"],
        ["metadata", "read"],
        ["pull_requests", "write"],
      ]),
    "granted permissions are exactly the least-privilege set",
    perms,
  );
  check(i.present, "the test repository is present in the installation");
  const other = await sql(
    `select count(*)::int as n from public.github_repositories where installation_row_id = '${i.id}' and lower(owner || '/' || name) <> lower('${REPO}')`,
  );
  check(other[0].n === 0, "the installation exposes no other repository", `${other[0].n} others`);

  const tenant = i.tenant_id;
  if (!i.allowed) {
    await sql(`
      update public.github_repositories set allowed = true, allowed_at = now(),
        allowed_by_principal_id = (select id from public.principals where tenant_id = '${tenant}' limit 1)
      where id = '${i.repo_id}' and tenant_id = '${tenant}'`);
    console.log("note  allowlisted the test repository (the same row the UI's Allow button writes)");
  }

  // GitHub cannot create a branch in a repository with no commits, and this script must never touch the default branch.
  if (EXPECT_MODE === "live") {
    const meta = gh(`repos/${REPO}`);
    let hasCommit = true;
    try {
      gh(`repos/${REPO}/branches/${meta.default_branch}`);
    } catch {
      hasCommit = false;
    }
    if (
      !check(hasCommit, "the repository has an initial commit on its default branch", meta.default_branch)
    ) {
      console.log(
        `\n${REPO} is empty. Add one commit to ${meta.default_branch} yourself (e.g. GitHub's "Add a README"); this script will not modify the default branch.`,
      );
      return;
    }
  }

  // 2. Fixture: agent, task bound to the repository, active contract, runtime key.
  const v = versions();
  secret = `authority_rk_${randomBytes(32).toString("hex")}`;
  const hash = createHash("sha256").update(secret).digest("hex");
  const [agentId, taskId, contractId, credId, princId] = [uid(), uid(), uid(), uid(), uid()];
  const actions = JSON.stringify({
    schemaVersion: 1,
    items: [
      "get_issue",
      "read_repository",
      "create_branch",
      "put_file",
      "create_pull_request",
      "get_pull_request",
    ].map((t) => ({ tool: `github.${t}`, constraints: [] })),
  });
  await sql(`
    insert into public.principals (id, tenant_id, kind, display_name) values ('${princId}', '${tenant}', 'human', 'Live verification principal');
    insert into public.agents (id, tenant_id, name, model_provider, model, framework, owner_principal_id, status)
      values ('${agentId}', '${tenant}', 'live-verify-${RUN}', 'openai', 'gpt', 'x', '${princId}', 'active');
    insert into public.tasks (id, tenant_id, agent_id, principal_id, intent, status)
      values ('${taskId}', '${tenant}', '${agentId}', '${princId}', 'Live verification: create a branch, one file and a draft PR on the test repository', 'contract_issued');
    insert into public.task_authority_contracts (id, tenant_id, task_id, version, spec_version, allowed_actions, forbidden_resources,
      forbidden_operations, ephemeral_limits, contract_status, registry_version, compiler_version, input_hash, output_hash,
      data_flow_bindings, required_approvals, activated_at, expires_at, required_approvals_spec, demo_key)
    values ('${contractId}', '${tenant}', '${taskId}', 1, 'v1', '${actions}'::jsonb, '{}', '{}',
      '{"schemaVersion":1,"maxToolInvocations":60,"expiresInSeconds":3600}'::jsonb, 'active', '${v.registry}', '${v.compiler}',
      repeat('9', 64), repeat('8', 64), '{"schemaVersion":1,"refs":[]}'::jsonb, '{"schemaVersion":1,"items":[]}'::jsonb,
      now(), now() + interval '1 hour', '{"schemaVersion":1,"items":[]}'::jsonb, 'live-verify:${RUN}');
    insert into public.agent_credentials (id, tenant_id, agent_id, key_prefix, key_hash, status)
      values ('${credId}', '${tenant}', '${agentId}', '${secret.slice(0, 21)}', '${hash}', 'active');
    insert into public.task_repository_bindings (tenant_id, task_id, repository_id, bound_by_principal_id)
      values ('${tenant}', '${taskId}', '${i.repo_id}', '${princId}');`);

  const defaultBranch = EXPECT_MODE === "live" ? gh(`repos/${REPO}`).default_branch : "main";
  const before = EXPECT_MODE === "live" ? gh(`repos/${REPO}/branches/${defaultBranch}`).commit.sha : "";
  const branch = `authority/${taskId.replace(/-/g, "").slice(0, 8)}/live-verify-${RUN}`;
  let n = 0;
  const run = async (tool, args, opts = {}) => {
    const key = `${RUN}-${++n}`;
    const resource = opts.resource ?? REPO;
    const auth = await api("POST", "/api/v1/authorize", {
      taskId,
      tool,
      operation: tool.split(".")[1],
      resource,
      arguments: args,
      idempotencyKey: `auth-${key}`,
    });
    const cap = auth.body?.capability?.token;
    if (!cap) return { auth, exec: null };
    const exec = await api("POST", "/api/v1/github/execute", {
      capability: cap,
      tool,
      operation: tool.split(".")[1],
      resource,
      arguments: args,
      idempotencyKey: opts.key ?? `exec-${key}`,
    });
    return { auth, exec, cap };
  };

  // 3. The workflow.
  const repoRead = await run("github.read_repository", {});
  check(
    repoRead.exec?.status === 200 && repoRead.exec.body.execution?.mode === EXPECT_MODE,
    "read repository metadata",
    `${repoRead.exec?.status} ${repoRead.exec?.body?.error?.code ?? ""}`,
  );
  check(
    repoRead.exec?.body?.data?.defaultBranch === defaultBranch,
    "connector saw the same default branch as GitHub",
    defaultBranch,
  );

  const b1 = await run("github.create_branch", { branch });
  check(
    b1.exec?.body?.result === "succeeded",
    "create task branch",
    `${b1.exec?.status} ${JSON.stringify(b1.exec?.body?.error ?? "")}`,
  );
  const b2 = await run("github.create_branch", { branch });
  check(b2.exec?.body?.result === "succeeded_noop", "creating the same branch again is an idempotent no-op");

  const file = {
    branch,
    path: `docs/authority-live-test/${RUN}.txt`,
    content: `Authority live verification ${RUN}\n`,
    message: `Authority live verification ${RUN}`,
  };
  const f1 = await run("github.put_file", file);
  check(
    f1.exec?.body?.result === "succeeded",
    "put file on the task branch",
    `${f1.exec?.status} ${JSON.stringify(f1.exec?.body?.error ?? "")}`,
  );
  const f2 = await run("github.put_file", file);
  check(f2.exec?.body?.result === "succeeded_noop", "writing identical content again is a no-op");

  const pr = {
    head: branch,
    base: defaultBranch,
    title: `Authority live verification ${RUN} (do not merge)`,
    body: "Created by scripts/live-verify.mjs. Safe to close; do not merge.",
    draft: true,
  };
  const p1 = await run("github.create_pull_request", pr);
  check(
    p1.exec?.body?.result === "succeeded",
    "create draft pull request",
    `${p1.exec?.status} ${JSON.stringify(p1.exec?.body?.error ?? "")}`,
  );
  const prNumber = p1.exec?.body?.data?.number;
  const p2 = await run("github.create_pull_request", pr);
  check(
    p2.exec?.body?.result === "succeeded_noop" && p2.exec?.body?.data?.number === prNumber,
    "creating the same PR again returns the existing one",
  );
  const g = prNumber ? await run("github.get_pull_request", { pull_number: String(prNumber) }) : null;
  check(g?.exec?.body?.result === "succeeded", "read the pull request back");

  // 4. Guardrails against the real deployment.
  const main = await run("github.create_branch", { branch: defaultBranch });
  check(
    main.exec?.body?.error?.code === "BRANCH_OUTSIDE_TASK_NAMESPACE",
    "writing the default branch is refused before GitHub",
  );
  const trav = await run("github.put_file", { branch, path: "../escape.txt", content: "x", message: "m" });
  check(trav.exec?.body?.error?.code === "PATH_TRAVERSAL", "path traversal is refused before GitHub");
  const wf = await run("github.put_file", {
    branch,
    path: ".github/workflows/x.yml",
    content: "x",
    message: "m",
  });
  check(wf.exec?.body?.error?.code === "PATH_FORBIDDEN", "writing a workflow file is refused");
  const url = await run("github.get_issue", { issue_number: "1", url: "https://evil.example/x" });
  check(url.exec?.body?.error?.code === "ARGUMENTS_INVALID", "a smuggled URL argument is refused");
  const elsewhere = await run(
    "github.get_issue",
    { issue_number: "1" },
    { resource: `${OWNER}/some-other-repo` },
  );
  check(
    elsewhere.exec?.body?.error?.code === "REPOSITORY_NOT_BOUND",
    "a repository the task is not bound to is refused (no GitHub call)",
  );
  const replayKey = `${RUN}-replay`;
  const rp1 = await run(
    "github.get_pull_request",
    { pull_number: String(prNumber ?? 1) },
    { key: replayKey },
  );
  if (rp1.cap) {
    const rp2 = await api("POST", "/api/v1/github/execute", {
      capability: rp1.cap,
      tool: "github.get_pull_request",
      operation: "get_pull_request",
      resource: REPO,
      arguments: { pull_number: String(prNumber ?? 1) },
      idempotencyKey: replayKey,
    });
    check(
      rp2.body?.replayed === true,
      "the same idempotency key replays the recorded outcome instead of re-executing",
    );
    const rp3 = await api("POST", "/api/v1/github/execute", {
      capability: rp1.cap,
      tool: "github.get_pull_request",
      operation: "get_pull_request",
      resource: REPO,
      arguments: { pull_number: String(prNumber ?? 1) },
      idempotencyKey: `${replayKey}-new`,
    });
    check(rp3.body?.error?.code === "CAPABILITY_ALREADY_USED", "a spent capability cannot be used again");
  }

  // 5. Independent confirmation with read-only GETs on the one repository.
  if (EXPECT_MODE === "live") {
    const after = gh(`repos/${REPO}/branches/${defaultBranch}`).commit.sha;
    check(
      after === before,
      "the default branch was NOT changed",
      `${before.slice(0, 7)} → ${after.slice(0, 7)}`,
    );
    const b = gh(`repos/${REPO}/branches/${encodeURIComponent(branch).replace(/%2F/g, "/")}`);
    check(Boolean(b.commit.sha), "the task branch exists on GitHub");
    const content = gh(`repos/${REPO}/contents/${file.path}?ref=${encodeURIComponent(branch)}`);
    check(
      Buffer.from(content.content, "base64").toString("utf8") === file.content,
      "the file on GitHub has exactly the requested content",
    );
    if (prNumber) {
      const p = gh(`repos/${REPO}/pulls/${prNumber}`);
      check(
        p.draft === true && p.merged === false && p.state === "open",
        "the PR is an open DRAFT and is NOT merged",
        `#${prNumber} ${p.html_url}`,
      );
      check(
        p.head.ref === branch && p.base.ref === defaultBranch,
        "PR head is the task branch and base is the default branch",
      );
    }
    const pulls = gh(`repos/${REPO}/pulls?head=${OWNER}:${encodeURIComponent(branch)}&state=all`);
    check(
      pulls.length === 1,
      "exactly one PR exists for the task branch (idempotency held)",
      `${pulls.length}`,
    );
  }

  // 6. Receipts and secret hygiene in the database.
  const receipts = await sql(
    `select execution_mode, result_category, tool, github_request_id, http_status_class from public.github_execution_receipts where task_id = '${taskId}' order by created_at`,
  );
  check(receipts.length >= 9, "receipts were recorded", `${receipts.length}`);
  check(
    receipts.every((r) => r.execution_mode === EXPECT_MODE),
    `every receipt is labelled ${EXPECT_MODE}`,
  );
  if (EXPECT_MODE === "live")
    check(
      receipts
        .filter((r) => r.result_category.startsWith("succeeded"))
        .every((r) => /^[A-Fa-f0-9:]+$/.test(r.github_request_id ?? "")),
      "successful receipts carry GitHub's request id",
    );
  const leaks = await sql(`
    select count(*)::int as n from (
      select row_to_json(r)::text t from public.github_execution_receipts r where r.task_id = '${taskId}'
      union all select row_to_json(e)::text from public.execution_events e where e.task_id = '${taskId}'
      union all select row_to_json(s)::text from public.capability_reservations s where s.task_id = '${taskId}'
      union all select row_to_json(q)::text from public.tool_requests q where q.task_id = '${taskId}') x
    where t ~ 'gh[pousr]_[A-Za-z0-9]{20}' or t ~ 'github_pat_' or t like '%PRIVATE KEY%' or t like '%${secret}%'`);
  check(
    leaks[0].n === 0,
    "no GitHub token, key or runtime secret is stored in receipts, events, reservations or requests",
  );

  // 7. Leave the evidence, remove the ability to act.
  await sql(
    `update public.agents set status = 'revoked' where id = '${agentId}'; update public.agent_credentials set status = 'revoked', revoked_at = now(), revocation_reason = 'live verification finished' where id = '${credId}';`,
  ).catch(() => undefined);
  console.log(
    `\nfixture task ${taskId} (agent revoked). Test PR left OPEN and unmerged for you to inspect: ${prNumber ? `https://github.com/${REPO}/pull/${prNumber}` : "(none created)"}`,
  );
}

main()
  .catch((e) => {
    failures++;
    console.error("ERROR", e.message);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
