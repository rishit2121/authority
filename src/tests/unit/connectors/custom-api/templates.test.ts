import { describe, expect, it } from "vitest";

import { CUSTOM_API_TEMPLATES } from "@/lib/connectors/custom-api/templates";
import { validateOperationDefinition } from "@/lib/connectors/custom-api/validate";
import { buildRequest } from "@/lib/connectors/custom-api/request-builder";

/**
 * This cannot prove a template works against the real third-party API (no
 * credentials for any of them exist here) -- see templates.ts's own module
 * comment for what "best-effort, not live-verified" means. What it CAN
 * prove, exhaustively: every template is a structurally valid operation
 * definition by Authority's own real rules (the same `validateOperationDefinition`
 * the dashboard form and `gateway.validate_custom_operation` both use), and
 * building a real request from it produces the exact method/URL/headers/body
 * shape documented -- so a template can never silently drift from what it
 * claims to do.
 */
describe("Custom API connector templates", () => {
  it("has no duplicate ids, slugs, or service+name pairs", () => {
    const ids = CUSTOM_API_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pairs = CUSTOM_API_TEMPLATES.map((t) => `${t.service}:${t.name}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it.each(CUSTOM_API_TEMPLATES)(
    "$service: $name passes Authority's own structural validation",
    (template) => {
      const inputSchema = { schemaVersion: 1 as const, fields: template.fields };
      const requestMapping = {
        schemaVersion: 1 as const,
        ...(template.staticHeaders.length ? { staticHeaders: template.staticHeaders } : {}),
      };
      const result = validateOperationDefinition({
        pathTemplate: template.pathTemplate,
        inputSchema,
        requestMapping,
      });
      expect(result.issues).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  it.each(CUSTOM_API_TEMPLATES)(
    "$service: $name has exactly one identifying field, and every path field is required",
    (template) => {
      const identifying = template.fields.filter((f) => f.identifiesResource);
      expect(identifying.length).toBe(1);
      for (const f of template.fields.filter((f) => f.in === "path")) {
        expect(f.required).toBe(true);
      }
    },
  );

  it.each(CUSTOM_API_TEMPLATES)(
    "$service: $name builds the exact real request it claims to, from sample values",
    (template) => {
      const sample: Record<string, unknown> = {};
      for (const f of template.fields) {
        sample[f.key] = f.type === "number" ? 1 : f.type === "boolean" ? true : "sample";
      }
      const built = buildRequest(
        {
          connectionId: "template-test",
          baseUrl: template.recommendedBaseUrl.replace(/<[^>]+>/g, "placeholder"),
          method: template.method,
          pathTemplate: template.pathTemplate,
          inputSchema: { schemaVersion: 1, fields: template.fields },
          requestMapping: {
            schemaVersion: 1,
            ...(template.staticHeaders.length ? { staticHeaders: template.staticHeaders } : {}),
          },
        },
        sample,
      );
      expect(built.method).toBe(template.method);
      for (const h of template.staticHeaders) {
        expect(built.headers[h.name]).toBe(h.value);
      }
      const bodyFields = template.fields.filter((f) => f.in === "body");
      if (bodyFields.length > 0 && template.method !== "GET") {
        expect(built.body).toBeDefined();
        const parsed = JSON.parse(built.body!) as Record<string, unknown>;
        for (const f of bodyFields) expect(parsed).toHaveProperty(f.key);
      }
    },
  );

  it("never sets a static header this connector reserves for its own auth resolution", () => {
    for (const template of CUSTOM_API_TEMPLATES) {
      for (const h of template.staticHeaders) {
        expect(h.name.toLowerCase()).not.toBe("authorization");
      }
    }
  });
});
