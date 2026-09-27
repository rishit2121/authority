import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { closeGatewayPool } from "@/lib/gateway/db";
import { runScenario } from "@/lib/validation/engine/runner";
import { SCENARIOS } from "@/lib/validation/library";
import { environmentSpecSchema } from "@/lib/validation/schema";

it("run library", async () => {
  const spec = environmentSpecSchema.parse({ schemaVersion: 1 });
  const only = process.env.ONLY?.split(",");
  const out: string[] = [];
  const list = SCENARIOS.filter((s) => !only || only.includes(s.key));
  for (const sc of list) {
    try {
      const r = await runScenario({
        scenario: sc,
        variant: process.env.VARIANT ?? "baseline",
        seed: 7,
        repetition: 1,
        ownerTenantId: null,
        actorUserId: null,
        limits: spec.limits,
        sandboxMinutes: 10,
      });
      out.push(
        `${r.result.verdict.toUpperCase().padEnd(5)} ${sc.key} (${r.result.durationMs}ms) destroyed=${r.sandboxDestroyed}`,
      );
      for (const s of r.result.steps)
        if (s.verdict !== "pass")
          out.push(
            `   - ${s.stepKey} [${s.kind}] ${s.verdict}: ${s.mismatches.join("; ")} | dec=${s.actual.finalDecision} codes=${s.actual.reasonCodes.join(",")} cap=${s.actual.capability} exec=${s.actual.execution} res=${s.actual.resultCode} ctl=${s.control}`,
          );
      for (const e of r.result.effects.filter((e) => e.violates))
        out.push(`   ! effect ${e.tool} violates: ${e.violates}`);
    } catch (e) {
      out.push(`ERROR ${sc.key}: ${(e as Error).message}`);
    }
    writeFileSync("/tmp/run.txt", out.join("\n"));
  }
  await closeGatewayPool();
}, 900_000);
