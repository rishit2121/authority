/**
 * Production readiness check. Verifies the deployment's configuration BEFORE traffic (offline: inspects the environment
 * you run it with), and optionally probes a running deployment (--url). Prints what is wrong, never a secret value.
 *
 *   npm run check:production                      # check this shell's environment (e.g. Render's env via a one-off job)
 *   npm run check:production -- --url https://authority-xxxx.onrender.com
 *
 * Exit 0 = ready, 1 = one or more blocking problems.
 */
import { existsSync, readFileSync } from "node:fs";

type Level = "fail" | "warn" | "ok";
const results: Array<{ level: Level; name: string; detail: string }> = [];
const add = (level: Level, name: string, detail: string) => results.push({ level, name, detail });

function loadEnvFile(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && process.env[t.slice(0, eq).trim()] === undefined)
      process.env[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const url = urlIdx >= 0 ? args[urlIdx + 1] : null;
  if (!args.includes("--no-env-file")) loadEnvFile(".env.local");
  const env = process.env;
  const has = (k: string) => Boolean(env[k]?.trim());

  const { gatewayTlsVerified, gatewayPlaintextAllowed } = await import("../src/lib/gateway/db");
  const { githubReadiness } = await import("../src/lib/github/config");

  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"])
    if (has(k)) add("ok", k, "set");
    else add("fail", k, "missing");
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"])
    if (has(k)) add("fail", k, "a service-role/secret key must not be present: nothing here uses one");

  if (!has("GATEWAY_DATABASE_URL"))
    add("fail", "GATEWAY_DATABASE_URL", "missing (the restricted authority_gateway login)");
  else {
    add("ok", "GATEWAY_DATABASE_URL", "set");
    if (/authority_gateway/.test(env.GATEWAY_DATABASE_URL!) === false)
      add(
        "warn",
        "GATEWAY_DATABASE_URL",
        "the login does not look like authority_gateway; it must be the restricted role",
      );
    if (
      env.GATEWAY_DATABASE_URL!.includes("service_role") ||
      /postgres(\.[a-z0-9]+)?:/.test(env.GATEWAY_DATABASE_URL!)
    )
      add(
        "fail",
        "GATEWAY_DATABASE_URL",
        "looks like the postgres/owner login; use the dedicated authority_gateway role",
      );
  }
  if (gatewayTlsVerified()) add("ok", "database TLS", "certificate chain is verified");
  else add("fail", "database TLS", "set GATEWAY_DATABASE_CA or _CA_FILE so the chain is verified");
  if (env.GATEWAY_DATABASE_SSL === "disable")
    add("fail", "GATEWAY_DATABASE_SSL", "plaintext database connections are for local CI only");
  void gatewayPlaintextAllowed;

  const pub = env.AUTHORITY_PUBLIC_URL?.trim();
  if (!pub) add("fail", "AUTHORITY_PUBLIC_URL", "missing");
  else if (!pub.startsWith("https://")) add("fail", "AUTHORITY_PUBLIC_URL", "must be https in production");
  else add("ok", "AUTHORITY_PUBLIC_URL", "https");

  const gh = githubReadiness({ ...env, NODE_ENV: "production" } as NodeJS.ProcessEnv);
  if (gh.mode === "mock") add("fail", "GitHub connector", "mock mode must not run in production");
  else if (gh.mode === "disabled")
    add("warn", "GitHub connector", "disabled: GitHub tools will not execute (fine if you do not use it)");
  else if (!gh.ready) add("fail", "GitHub connector", `live mode is missing: ${gh.missing.join(", ")}`);
  else add("ok", "GitHub connector", "live and fully configured");
  if (env.AUTHORITY_ALLOW_MOCK_GITHUB === "1")
    add("fail", "AUTHORITY_ALLOW_MOCK_GITHUB", "must not be set in production");
  if (env.AUTHORITY_DEPLOYMENT === "local")
    add("fail", "AUTHORITY_DEPLOYMENT", "'local' relaxes TLS checks and is for local production builds only");

  if (!has("MAINTENANCE_TOKEN") && env.AUTHORITY_SCHEDULER === "off")
    add(
      "fail",
      "maintenance",
      "the in-process scheduler is off and no MAINTENANCE_TOKEN is set for an external cron",
    );
  else if (env.AUTHORITY_SCHEDULER === "off") add("ok", "maintenance", "external cron via MAINTENANCE_TOKEN");
  else add("ok", "maintenance", "in-process scheduler enabled");
  if (has("MAINTENANCE_TOKEN") && env.MAINTENANCE_TOKEN!.trim().length < 24)
    add("fail", "MAINTENANCE_TOKEN", "shorter than 24 characters");
  if (!has("SEMANTIC_PROVIDER_API_KEY"))
    add(
      "warn",
      "semantic provider",
      "no provider key: the deterministic mock provider is the only option (tenants cannot enforce with it in production)",
    );

  if (url) {
    const base = url.replace(/\/$/, "");
    for (const p of ["/api/v1/health", "/api/v1/ready"]) {
      try {
        const res = await fetch(base + p, { signal: AbortSignal.timeout(15_000) });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        add(res.ok ? "ok" : "fail", `GET ${p}`, `${res.status} ${JSON.stringify(body)}`);
      } catch {
        add("fail", `GET ${p}`, "unreachable");
      }
    }
  }

  const glyph = { ok: "PASS", warn: "WARN", fail: "FAIL" } as const;
  for (const r of results) console.log(`${glyph[r.level]}  ${r.name}: ${r.detail}`);
  const failed = results.filter((r) => r.level === "fail").length;
  console.log(failed === 0 ? "\nReady for production." : `\n${failed} blocking problem(s).`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`check failed to run: ${(e as Error).message}`);
    process.exit(1);
  },
);
