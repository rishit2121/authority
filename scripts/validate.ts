/**
 * Authority validation CLI: runs a scenario pack (or chosen scenarios) against the real authorization gateway with
 * mock integrations, in throwaway sandbox tenants, and reports machine-readable results.
 *
 *   npm run validate -- --pack starter --format json --out validation-report.json
 *
 * Exit codes: 0 = pass, 1 = findings / a regression (a contained attack became allowed), 2 = usage error,
 * 3 = infrastructure error (database unreachable, engine failure). Needs no production credentials: only a database with
 * the Authority migrations and the restricted `authority_gateway` login (GATEWAY_DATABASE_URL).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function loadEnvFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined)
      process.env[key] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

const USAGE = `Usage: npm run validate -- [options]
  --pack <key>            scenario pack (default: starter). Packs: starter, hardening-gaps
  --scenarios <a,b,...>   run specific scenario keys instead of a pack
  --variants <a,b,...>    control configurations (default: the pack's, or baseline)
  --repetitions <n>       1-5 (default 1)
  --seed <n>              deterministic seed (default 1)
  --format <json|text>    stdout format (default text)
  --out <file>            also write the full JSON report to a file
  --baseline <file>       fail if any run that passed in this baseline no longer passes
  --write-baseline <file> write a baseline of current verdicts
  --strict                fail on any non-passing run even for informational packs
  --concurrency <n>       parallel sandboxes, 1-4 (default 3)
  --list                  list packs and scenarios and exit
Exit codes: 0 pass | 1 findings or regression | 2 usage | 3 infrastructure error`;

function parseArgs(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    if (["strict", "list", "help"].includes(key)) o[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${key} needs a value`);
      o[key] = v;
    }
  }
  return o;
}

async function main(): Promise<number> {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".supabase-cli.env"));

  let args: Record<string, string | boolean>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const { PACKS, SCENARIOS, SCENARIO_BY_KEY, packByKey } = await import("../src/lib/validation/library");
  if (args.list) {
    console.log(
      JSON.stringify(
        {
          packs: PACKS.map((p) => ({
            key: p.key,
            scenarios: p.scenarioKeys.length,
            variants: p.variants,
            expectation: p.expectation,
          })),
          scenarios: SCENARIOS.map((s) => ({
            key: s.key,
            category: s.category,
            severity: s.severity,
            variants: s.variants.map((v) => v.label),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const format = String(args.format ?? "text");
  if (!["json", "text"].includes(format)) {
    console.error(`--format must be json or text\n\n${USAGE}`);
    return 2;
  }
  const packKey = args.scenarios ? null : String(args.pack ?? "starter");
  const pack = packKey ? packByKey(packKey) : undefined;
  if (packKey && !pack) {
    console.error(`unknown pack: ${packKey}\n\n${USAGE}`);
    return 2;
  }
  const scenarioKeys = pack
    ? pack.scenarioKeys
    : String(args.scenarios)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const unknown = scenarioKeys.filter((k) => !SCENARIO_BY_KEY.has(k));
  if (unknown.length > 0) {
    console.error(`unknown scenario(s): ${unknown.join(", ")}\n\n${USAGE}`);
    return 2;
  }
  const variants = args.variants
    ? String(args.variants)
        .split(",")
        .map((s) => s.trim())
    : (pack?.variants ?? ["baseline"]);
  const repetitions = Number(args.repetitions ?? 1);
  const seed = Number(args.seed ?? 1);
  const concurrency = Number(args.concurrency ?? 3);
  if (
    ![repetitions, seed, concurrency].every(Number.isInteger) ||
    repetitions < 1 ||
    repetitions > 5 ||
    concurrency < 1 ||
    concurrency > 4
  ) {
    console.error(`--repetitions must be 1-5, --seed an integer, --concurrency 1-4\n\n${USAGE}`);
    return 2;
  }

  if (!process.env.GATEWAY_DATABASE_URL?.trim()) {
    console.error(
      "GATEWAY_DATABASE_URL is not set (the restricted authority_gateway login). See docs/validation/CI.md.",
    );
    return 3;
  }

  const { runCampaign } = await import("../src/lib/validation/engine/campaign");
  const { closeGatewayPool } = await import("../src/lib/gateway/db");
  const { environmentSpecSchema } = await import("../src/lib/validation/schema");
  const { buildReportJson } = await import("../src/lib/validation/report");
  const { GATEWAY_VERSION } = await import("../src/lib/gateway/pipeline");
  const { COMPILER_VERSION } = await import("../src/lib/authorization/contract-compiler");
  const { registry } = await import("../src/lib/validation/engine/compile");

  const spec = environmentSpecSchema.parse({ schemaVersion: 1 });
  let report;
  try {
    report = await runCampaign({
      config: { scenarioKeys, variants, repetitions },
      spec,
      seed,
      persist: null,
      ownerTenantId: null,
      actorUserId: null,
      concurrency,
      onProgress: ({ done, total }) => {
        if (format === "text" && process.stderr.isTTY)
          process.stderr.write(`\r[validate] ${done}/${total} runs`);
      },
    });
  } catch (e) {
    console.error(`\ninfrastructure error: ${(e as Error).name}: ${(e as Error).message}`);
    return 3;
  } finally {
    await closeGatewayPool().catch(() => undefined);
  }
  if (format === "text") process.stderr.write("\n");

  const verdicts: Record<string, string> = {};
  for (const r of [...report.runs].sort((a, b) =>
    `${a.result.scenarioKey}@${a.result.variant}`.localeCompare(
      `${b.result.scenarioKey}@${b.result.variant}`,
    ),
  ))
    verdicts[`${r.result.scenarioKey}@${r.result.variant}`] = r.result.verdict;
  const errored = report.runs.filter((r) => r.result.verdict === "error");

  let regressions: string[] = [];
  if (typeof args.baseline === "string") {
    let baseline: Record<string, string>;
    try {
      baseline = JSON.parse(readFileSync(args.baseline, "utf8")).verdicts as Record<string, string>;
    } catch {
      console.error(`could not read baseline ${args.baseline}`);
      return 2;
    }
    regressions = Object.entries(baseline)
      .filter(([k, v]) => v === "pass" && k in verdicts && verdicts[k] !== "pass")
      .map(([k]) => k);
  }

  const failing = report.runs.filter((r) => r.result.verdict !== "pass");
  const enforce = Boolean(args.strict) || !pack || pack.expectation === "all_pass";
  const exit =
    errored.length > 0 && report.runs.length === errored.length
      ? 3
      : regressions.length > 0 || (enforce && failing.length > 0)
        ? 1
        : 0;

  const full = buildReportJson({
    title: `Authority validation: ${pack?.key ?? "custom"}`,
    environment: {
      name: "ephemeral (CLI)",
      sandboxMinutes: spec.sandboxMinutes,
      limits: spec.limits as unknown as Record<string, number>,
    },
    campaign: {
      id: null,
      status: report.status,
      seed,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      durationMs: report.durationMs,
      pack: pack?.key ?? null,
      variants,
      truncated: report.truncated,
      notes: report.notes,
    },
    versions: { gateway: GATEWAY_VERSION, registry: registry.registryVersion, compiler: COMPILER_VERSION },
    runs: report.runs.map((r) => ({
      result: r.result,
      title: r.scenario.title,
      category: r.scenario.category,
      severity: r.scenario.severity,
      intent: r.scenario.intent,
      taxonomy: r.scenario.taxonomy,
      controls: r.result.metrics.controlsExercised,
      effectiveAuthority: {
        tools: r.effective.allowedActions.map((a) => a.tool),
        semanticMode: r.effective.semanticMode,
        approvalClasses: r.effective.approvalClasses,
      },
    })),
    findings: report.findings,
    metrics: report.metrics,
  });
  const out = { exitCode: exit, pass: exit === 0, regressions, verdicts, report: full };

  const write = (file: string, body: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  if (typeof args.out === "string") write(args.out, JSON.stringify(out, null, 2));
  if (typeof args["write-baseline"] === "string")
    write(args["write-baseline"], JSON.stringify({ synthetic: true, verdicts }, null, 2) + "\n");

  if (format === "json")
    await new Promise<void>((done) =>
      process.stdout.write(JSON.stringify(out, null, 2) + "\n", () => done()),
    );
  else {
    const m = report.metrics;
    const rate = (r: { numerator: number; denominator: number }) => `${r.numerator}/${r.denominator}`;
    console.log(`Authority validation (synthetic) — pack ${pack?.key ?? "custom"}, seed ${seed}`);
    console.log(
      `  runs: ${m.runs.passed} passed, ${m.runs.failed} failed, ${m.runs.errored} errored of ${m.runs.total}`,
    );
    console.log(
      `  attack containment ${rate(m.attackContainmentRate)}   false negatives ${rate(m.falseNegativeRate)}   false positives ${rate(m.falsePositiveRate)}`,
    );
    console.log(
      `  unauthorized effects: ${m.residualBlastRadius.unauthorizedEffects}   controls exercised: ${m.controlCoverage.controlsExercised.length}/${m.controlCoverage.controlsAvailable}`,
    );
    for (const r of failing) {
      const bad = r.result.steps.filter((s) => s.verdict !== "pass");
      console.log(
        `  ${r.result.verdict.toUpperCase()}  ${r.result.scenarioKey}@${r.result.variant}: ${bad.map((s) => `${s.stepKey} (${s.mismatches[0] ?? "mismatch"})`).join("; ")}`,
      );
    }
    for (const k of regressions) console.log(`  REGRESSION  ${k} passed in the baseline and no longer does`);
    console.log(exit === 0 ? "RESULT: pass" : `RESULT: fail (exit ${exit})`);
  }
  return exit;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`infrastructure error: ${(e as Error).message}`);
    process.exit(3);
  },
);
