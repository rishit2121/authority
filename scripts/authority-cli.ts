/**
 * The repo-local Authority CLI: `npm run authority -- <command>`. Nothing here is published; it runs from a clone.
 *
 *   demo    Runs a Proof Run recipe through a real local Authority (prepare, session, authorize, execute) against a
 *           mock Slack transport, and prints each attempt next to what the recipe expects. Exits non-zero when an
 *           expected block became an allow, a reason changed, or an unexpected provider dispatch happened.
 *   init    Previews a small server-side starter that uses @authority/sdk. Writes nothing unless you pass --yes, never
 *           overwrites a file, never installs anything.
 *   doctor  Read-only checks of this machine and (with --dir) a starter's .env. Never prints a secret.
 *
 * Every command only talks to this machine (local Supabase, localhost) unless you point `doctor --dir` at a starter
 * whose AUTHORITY_URL is elsewhere; then it only calls that deployment's public health endpoints.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_RECIPE = "examples/proof-run/engineering-update.json";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** The throwaway password the local suites and CI give the restricted gateway login. Local databases only. */
const LOCAL_GATEWAY_PASSWORD = process.env.LOCAL_GATEWAY_PASSWORD ?? "ci-only-gateway-password";
const STARTER_SOURCE = "examples/sdk-quickstart";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const red = paint("31");
const yellow = paint("33");

function fail(message: string): never {
  console.error(`${red("error")} ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) fail(`unexpected argument "${arg}"`);
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { command, flags };
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  if (value === true) fail(`--${key} needs a value`);
  return value === undefined ? undefined : String(value);
}

/** `supabase status -o env`, keeping only what the local suites need. Never printed. */
function localSupabase(): { API_URL: string; ANON_KEY: string; DB_URL: string } | null {
  let out: string;
  try {
    out = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    return null;
  }
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  const anonKey = env.ANON_KEY ?? env.PUBLISHABLE_KEY;
  if (!env.API_URL || !anonKey || !env.DB_URL) return null;
  for (const url of [env.API_URL, env.DB_URL]) {
    if (!LOCAL_HOSTS.has(new URL(url).hostname))
      fail("Supabase status points at a non-local host; refusing.");
  }
  return { API_URL: env.API_URL, ANON_KEY: anonKey, DB_URL: env.DB_URL };
}

/** The local gateway login's URL: the local database from `supabase status`, as the restricted role. */
function localGatewayUrl(dbUrl: string): string {
  const url = new URL(dbUrl);
  url.username = "authority_gateway";
  url.password = LOCAL_GATEWAY_PASSWORD;
  return url.toString();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) fail("refusing to connect to a non-local database.");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function expectedSchemaVersion(): string {
  const source = readFileSync(path.join(ROOT, "src/lib/gateway/schema-version.ts"), "utf8");
  return /EXPECTED_SCHEMA_VERSION = "(\d+)"/.exec(source)?.[1] ?? "unknown";
}

// ---------------------------------------------------------------------------------------------------------- demo

interface Report {
  title: string;
  recipeHash: string;
  attempts: Array<{
    id: string;
    label: string;
    expect: { outcome: "executed" | "blocked"; reasonCode?: string; dispatches: number };
    got: {
      decision: string;
      reasonCodes: string[];
      dispatches: number;
      result: string;
      receipt: { receiptId: string } | null;
    } | null;
  }>;
  slackDispatches: number;
  gmailRequests: number;
}

function outcomeText(result: string) {
  switch (result) {
    case "executed":
      return "Allowed · executed";
    case "blocked_before_dispatch":
      return "Blocked before dispatch";
    case "result_held":
      return "Allowed · result held";
    case "indeterminate":
      return "Allowed · outcome unknown";
    default:
      return "Allowed · provider failed";
  }
}

async function demo(flags: Record<string, string | boolean>) {
  const recipe = path.resolve(stringFlag(flags, "recipe") ?? DEFAULT_RECIPE);
  if (!existsSync(recipe)) fail(`recipe not found: ${path.relative(process.cwd(), recipe)}`);
  const supabase = localSupabase();
  if (!supabase) {
    fail(
      "local Supabase is not running. Start it from the repo root with `npx supabase start` (needs Docker), then re-run.",
    );
  }
  // The restricted gateway login exists in every migration; locally it gets a fixed, throwaway password (as in CI).
  // DB_URL from `supabase status` is the local superuser; withClient refuses anything that is not this machine.
  await withClient(supabase.DB_URL, (c) =>
    c.query(
      `alter role authority_gateway with login password '${LOCAL_GATEWAY_PASSWORD.replace(/'/g, "''")}'`,
    ),
  ).catch((e: Error) => fail(`could not prepare the local gateway login: ${e.message}`));

  const reportPath = path.join(mkdtempSync(path.join(tmpdir(), "authority-proof-run-")), "report.json");
  console.log(
    `${bold("Proof Run")} ${dim(recipe.startsWith(`${ROOT}${path.sep}`) ? path.relative(ROOT, recipe) : recipe)}`,
  );
  console.log(dim("Local Authority · mock Slack transport · no real accounts or providers\n"));
  const run = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.local.config.mts", "src/tests/local/proof-run.test.ts"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...supabase,
        LOCAL_GATEWAY_DATABASE_URL: localGatewayUrl(supabase.DB_URL),
        PROOF_RUN_RECIPE: recipe,
        PROOF_RUN_REPORT: reportPath,
        ...(flags.capture ? { PROOF_RUN_CAPTURE: "1" } : {}),
      },
      stdio: flags.verbose ? "inherit" : ["ignore", "pipe", "pipe"],
    },
  );
  if (!existsSync(reportPath)) {
    if (!flags.verbose) process.stderr.write(run.stdout?.toString() ?? "");
    fail("the runner did not produce a report (see the output above).");
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
  console.log(bold(report.title));
  let matched = 0;
  for (const a of report.attempts) {
    const got = a.got;
    const ok =
      got !== null &&
      got.dispatches === a.expect.dispatches &&
      (a.expect.outcome === "executed"
        ? got.result === "executed"
        : got.result === "blocked_before_dispatch" &&
          (!a.expect.reasonCode || got.reasonCodes.includes(a.expect.reasonCode)));
    if (ok) matched++;
    const mark = ok ? green("✓") : red("✗");
    const outcome = got ? outcomeText(got.result) : "did not run";
    const detail = got ? (got.receipt ? `receipt ${got.receipt.receiptId}` : got.reasonCodes.join(", ")) : "";
    const dispatchText = got ? `${got.dispatches} dispatch${got.dispatches === 1 ? "" : "es"}` : "";
    console.log(
      `  ${mark} ${a.label.padEnd(28)} ${outcome.padEnd(26)} ${dispatchText.padEnd(13)} ${dim(detail)}`,
    );
    if (!ok) {
      const expected =
        a.expect.outcome === "executed"
          ? `executed with ${a.expect.dispatches} dispatch`
          : `blocked (${a.expect.reasonCode ?? "any reason"}) with ${a.expect.dispatches} dispatches`;
      console.log(`      ${red("expected")} ${expected}`);
    }
  }
  const expectedDispatches = report.attempts.reduce((s, a) => s + a.expect.dispatches, 0);
  console.log(
    `\n${matched}/${report.attempts.length} attempts matched the recipe. Mock Slack received ${report.slackDispatches} ` +
      `post${report.slackDispatches === 1 ? "" : "s"} (expected ${expectedDispatches}); Gmail received ${report.gmailRequests}.`,
  );
  if (flags.capture && run.status === 0) console.log(dim("Wrote examples/proof-run/captured-run.json"));
  if (run.status !== 0) {
    if (!flags.verbose) console.log(dim("Re-run with --verbose for the full test output."));
    process.exit(run.status ?? 1);
  }
  console.log(green("Proof Run passed."));
}

// ---------------------------------------------------------------------------------------------------------- init

function starterFiles(targetDir: string): Array<{ file: string; content: string }> {
  const source = path.join(ROOT, STARTER_SOURCE);
  if (!existsSync(source)) fail(`${STARTER_SOURCE} is missing from this checkout.`);
  const tarball = path.join(ROOT, "public/sdk/authority-sdk.tgz");
  const relTarball = path.relative(targetDir, tarball).split(path.sep).join("/");
  const name = path
    .basename(targetDir)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
  const read = (f: string) => readFileSync(path.join(source, f), "utf8");
  const files = [
    {
      file: "package.json",
      content: `${JSON.stringify(
        {
          name: name || "my-agent",
          private: true,
          type: "module",
          scripts: {
            start: "node --env-file=.env --import tsx index.ts",
            "openai-agent": "node --env-file=.env --import tsx openai-agent.ts",
            typecheck: "tsc --noEmit",
          },
          dependencies: { "@authority/sdk": `file:${relTarball}` },
          devDependencies: { tsx: "^4.23.15", typescript: "^5.9.2", "@types/node": "^22.0.0" },
        },
        null,
        2,
      )}\n`,
    },
    {
      file: "tsconfig.json",
      content: `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
          include: ["*.ts"],
        },
        null,
        2,
      )}\n`,
    },
    { file: ".gitignore", content: "node_modules\n.env\n" },
    { file: ".env.example", content: read(".env.example") },
    // Every source file of the example, so local imports (./outcomes) resolve in the starter too.
    ...readdirSync(source)
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((file) => ({ file, content: read(file) })),
  ];
  return files;
}

function init(flags: Record<string, string | boolean>) {
  const dir = stringFlag(flags, "dir");
  if (!dir) fail("pass --dir <path> for the new starter, e.g. --dir ../my-agent");
  const target = path.resolve(dir);
  if (target === ROOT || target.startsWith(`${ROOT}${path.sep}`))
    fail("choose a directory outside this repository (for example ../my-agent).");
  const files = starterFiles(target);
  const clashes = files.filter((f) => existsSync(path.join(target, f.file))).map((f) => f.file);

  console.log(`${bold("Starter preview")} → ${target}\n`);
  for (const f of files) {
    const lines = f.content.split("\n").length - 1;
    const clash = clashes.includes(f.file) ? red(" (exists, will not overwrite)") : "";
    console.log(`  ${f.file.padEnd(18)} ${dim(`${lines} lines`)}${clash}`);
  }
  if (flags.show) {
    for (const f of files) console.log(`\n${bold(`── ${f.file}`)}\n${f.content}`);
  } else {
    console.log(dim("\nAdd --show to print every file."));
  }
  console.log(
    dim(
      "No secrets are written: .env.example holds placeholders only. Nothing is installed; the SDK comes from a local tarball.",
    ),
  );
  if (clashes.length > 0) fail(`${clashes.length} file(s) already exist in ${target}; nothing was written.`);
  if (!flags.yes) {
    console.log(`\nNothing written. Re-run with ${bold("--yes")} to create these ${files.length} files.`);
    return;
  }
  mkdirSync(target, { recursive: true });
  for (const f of files) writeFileSync(path.join(target, f.file), f.content, { flag: "wx" });
  const tarballBuilt = existsSync(path.join(ROOT, "public/sdk/authority-sdk.tgz"));
  console.log(`\n${green("Created")} ${files.length} files in ${target}\n\nNext:`);
  if (!tarballBuilt) console.log(`  node scripts/pack-sdk.mjs`);
  const relative = path.relative(process.cwd(), target);
  console.log(`  cd ${relative.startsWith("../..") ? target : relative || "."}`);
  console.log("  npm install");
  console.log("  cp .env.example .env");
  console.log(dim("  Fill .env from Authority's setup page (/app/setup → Use it in your code), then:"));
  console.log("  npm start");
}

// -------------------------------------------------------------------------------------------------------- doctor

type Check = { name: string; status: "ok" | "warn" | "fail" | "skip"; detail: string };

function parseEnvFile(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const PLACEHOLDER = /^(|<.*>|\.\.\.|changeme|your[-_].*|xxx+)$/i;

/** Classifies a secret without revealing it: set / missing / placeholder / wrong kind. */
function secretCheck(name: string, value: string | undefined, prefix: string | null): Check {
  if (value === undefined) return { name, status: "fail", detail: "missing" };
  if (PLACEHOLDER.test(value.trim())) return { name, status: "fail", detail: "still a placeholder" };
  if (prefix && !value.startsWith(prefix)) {
    const kind = /^authority_([a-z]{2})_/.exec(value)?.[1];
    const names: Record<string, string> = {
      dk: "a backend key",
      rk: "a runtime key",
      ts: "a task session token",
    };
    return {
      name,
      status: "fail",
      detail: kind
        ? `set, but holds ${names[kind] ?? "another credential"}`
        : `set, but not an ${prefix}… key`,
    };
  }
  return { name, status: "ok", detail: "set (value not shown)" };
}

async function fetchStatus(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    return res.status;
  } catch {
    return null;
  }
}

async function doctor(flags: Record<string, string | boolean>) {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js",
    status: major >= 22 ? "ok" : "fail",
    detail: `${process.versions.node}${major >= 22 ? "" : " (needs 22 or newer)"}`,
  });
  checks.push({
    name: "Dependencies",
    status: existsSync(path.join(ROOT, "node_modules/next")) ? "ok" : "fail",
    detail: existsSync(path.join(ROOT, "node_modules/next")) ? "installed" : "run npm ci",
  });

  const supabase = localSupabase();
  checks.push({
    name: "Local Supabase",
    status: supabase ? "ok" : "warn",
    detail: supabase ? `running at ${new URL(supabase.API_URL).host}` : "not running (npx supabase start)",
  });
  if (supabase) {
    const expected = expectedSchemaVersion();
    const actual = await withClient(supabase.DB_URL, async (c) => {
      const r = await c.query<{ v: string }>("select gateway.schema_version() as v");
      return r.rows[0]?.v ?? null;
    }).catch(() => null);
    checks.push({
      name: "Local migrations",
      status: actual === expected ? "ok" : "fail",
      detail:
        actual === expected ? `at ${expected}` : `database ${actual ?? "unknown"}, code expects ${expected}`,
    });
    const gateway = await withClient(localGatewayUrl(supabase.DB_URL), (c) => c.query("select 1")).then(
      () => true,
      () => false,
    );
    checks.push({
      name: "Gateway login",
      status: gateway ? "ok" : "warn",
      detail: gateway ? "connects" : "not provisioned yet (npm run authority -- demo sets it up locally)",
    });
  }

  const tarball = path.join(ROOT, "public/sdk/authority-sdk.tgz");
  checks.push({
    name: "SDK tarball",
    status: existsSync(tarball) ? "ok" : "warn",
    detail: existsSync(tarball) ? "public/sdk/authority-sdk.tgz" : "not built (node scripts/pack-sdk.mjs)",
  });

  const envLocal = path.join(ROOT, ".env.local");
  if (existsSync(envLocal)) {
    const env = parseEnvFile(envLocal);
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "GATEWAY_DATABASE_URL",
    ]) {
      const value = env[key];
      let where = "";
      try {
        if (value) where = LOCAL_HOSTS.has(new URL(value).hostname) ? ", local" : ", NOT local";
      } catch {
        // Not a URL (a key): nothing to classify.
      }
      checks.push({
        name: `.env.local ${key}`,
        status: value ? (where === ", NOT local" ? "warn" : "ok") : "warn",
        detail: value ? `set${where}` : "missing",
      });
    }
  } else {
    checks.push({ name: ".env.local", status: "skip", detail: "absent (only needed for npm run dev)" });
  }

  const dev = await fetchStatus("http://localhost:3000/api/v1/health");
  checks.push({
    name: "Dev server",
    status: dev === 200 ? "ok" : "skip",
    detail: dev === 200 ? "http://localhost:3000 healthy" : "not running on :3000",
  });
  if (dev === 200) {
    const ready = await fetchStatus("http://localhost:3000/api/v1/ready");
    checks.push({
      name: "Dev server readiness",
      status: ready === 200 ? "ok" : "fail",
      detail: ready === 200 ? "ready" : `not ready (HTTP ${ready ?? "error"})`,
    });
  }

  const dir = stringFlag(flags, "dir");
  if (dir) {
    const envFile = path.join(path.resolve(dir), ".env");
    if (!existsSync(envFile)) {
      checks.push({ name: `${dir}/.env`, status: "fail", detail: "missing (cp .env.example .env)" });
    } else {
      const env = parseEnvFile(envFile);
      let origin: string | null = null;
      try {
        origin = new URL(env.AUTHORITY_URL ?? "").origin;
      } catch {
        // reported below
      }
      checks.push({
        name: "AUTHORITY_URL",
        status: origin ? "ok" : "fail",
        detail: origin ?? "missing or not a URL",
      });
      checks.push(secretCheck("AUTHORITY_BACKEND_API_KEY", env.AUTHORITY_BACKEND_API_KEY, "authority_dk_"));
      checks.push(
        secretCheck("AUTHORITY_AGENT_RUNTIME_KEY", env.AUTHORITY_AGENT_RUNTIME_KEY, "authority_rk_"),
      );
      checks.push(secretCheck("AUTHORITY_AGENT_ID", env.AUTHORITY_AGENT_ID, null));
      for (const key of Object.keys(env).filter((k) => k.endsWith("_CONNECTION_ID")))
        checks.push(secretCheck(key, env[key], null));
      if (origin) {
        const health = await fetchStatus(`${origin}/api/v1/health`);
        checks.push({
          name: "Authority reachable",
          status: health === 200 ? "ok" : "fail",
          detail: health === 200 ? "health OK" : `health check failed (${health ?? "no response"})`,
        });
      }
      const installed = existsSync(path.join(path.resolve(dir), "node_modules/@authority/sdk"));
      checks.push({
        name: "Starter dependencies",
        status: installed ? "ok" : "warn",
        detail: installed ? "@authority/sdk installed" : "run npm install in the starter",
      });
    }
  }

  const icon = { ok: green("✓"), warn: yellow("!"), fail: red("✗"), skip: dim("–") };
  console.log(`${bold("Authority doctor")} ${dim("(read-only; secrets are never printed)")}\n`);
  for (const c of checks) console.log(`  ${icon[c.status]} ${c.name.padEnd(42)} ${dim(c.detail)}`);
  const failed = checks.filter((c) => c.status === "fail").length;
  console.log(failed ? `\n${red(`${failed} problem(s) found.`)}` : `\n${green("No problems found.")}`);
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------------------------------------------------------------------ main

const HELP = `Usage: npm run authority -- <command> [options]

  demo     [--recipe <file>] [--capture] [--verbose]
           Run a Proof Run recipe against a local Authority and a mock Slack.
  init     --dir <path> [--show] [--yes]
           Preview a server-side starter; writes only with --yes, never overwrites.
  doctor   [--dir <starter>]
           Read-only, redacted checks of this machine and a starter's .env.
`;

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "demo") return demo(flags);
  if (command === "init") return init(flags);
  if (command === "doctor") return doctor(flags);
  if (command === "examples") {
    console.log(
      readdirSync(path.join(ROOT, "examples/proof-run"))
        .filter((f) => f.endsWith(".json"))
        .join("\n"),
    );
    return;
  }
  console.log(HELP);
  process.exit(command && command !== "help" && command !== "--help" ? 1 : 0);
}

void main();
