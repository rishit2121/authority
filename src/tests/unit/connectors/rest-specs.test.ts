import { describe, expect, it } from "vitest";

import { REST_CONNECTOR_SPECS } from "@/lib/connectors/rest/providers";
import { restConnectorSpecSchema, specProblems } from "@/lib/connectors/rest/spec";

/** Connector ids that already have a hand-written connector or a per-connection id prefix. */
const RESERVED = new Set([
  "slack",
  "gmail",
  "github",
  "notion",
  "linear",
  "stripe",
  "postgresql",
  "custom",
  "custom_api",
]);

describe("declarative REST connector specs", () => {
  it("has unique ids that never collide with a hand-written connector", () => {
    const ids = REST_CONNECTOR_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(RESERVED.has(id), id).toBe(false);
      expect(id.startsWith("custom_") || id.startsWith("postgres_"), id).toBe(false);
    }
  });

  it("has unique display names", () => {
    const names = REST_CONNECTOR_SPECS.map((s) => s.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  describe.each(REST_CONNECTOR_SPECS.map((s) => [s.id, s] as const))("%s", (_id, spec) => {
    it("is structurally valid", () => {
      expect(specProblems(spec)).toEqual([]);
    });

    it("talks only to an https host it names literally (or a literal suffix)", () => {
      const parsed = restConnectorSpecSchema.parse(spec);
      const literal = parsed.host.replace(/^\{config\.[a-z0-9_]+\}\./, "");
      expect(literal).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(literal).not.toMatch(/localhost|internal|127\.|169\.254|\.local$/);
      if (parsed.host.startsWith("{config.")) {
        const field = parsed.host.slice(8, parsed.host.indexOf("}"));
        const def = parsed.configFields.find((f) => f.key === field)!;
        // The substituted label can't contain a dot, slash or colon, so it can't escape the suffix.
        for (const escape of ["evil.com#", "a.b", "a/b", "a:1", "a@b", ""]) {
          expect(new RegExp(def.pattern).test(escape), `${field} accepts ${escape}`).toBe(false);
        }
      }
    });

    it("declares at least one read, and flags what leaves the organization or moves money", () => {
      const parsed = restConnectorSpecSchema.parse(spec);
      expect(parsed.operations.some((op) => op.sideEffect === "read")).toBe(true);
      for (const op of parsed.operations) {
        if (op.sideEffect === "read") {
          expect(op.externalCommunication, op.slug).toBe(false);
          expect(op.financialImpact, op.slug).toBe(false);
        }
      }
    });
  });
});
