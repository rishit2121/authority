import { z } from "zod";

/**
 * Declarative REST connectors.
 *
 * Each provider (Sentry, Asana, HubSpot, ...) is one `RestConnectorSpec`: a fixed host, how the stored credential
 * is attached, and a short list of audited operations. One generic connector (connector.ts) executes every spec, and
 * the registry operations/permissions are generated from the same spec (registry.ts), so what Authority authorizes
 * and what it sends can never drift apart.
 *
 * What a spec can never do:
 *  - choose its host at runtime: the host is a literal, or a literal suffix with one DNS label taken from a
 *    validated connection setting (e.g. `{config.subdomain}.zendesk.com`);
 *  - send an argument it did not declare: every declared argument has exactly one place (path, query or body), and
 *    the generic connector refuses anything else;
 *  - put the credential anywhere but the auth headers, basic auth or the declared auth query parameter.
 *
 * Templates: `{key}` is the stored secret (an API key or token), `{config.<field>}` a connection setting declared in
 * `configFields`. Nothing else is substituted.
 */

export const REST_ARG_TYPES = ["string", "number", "boolean", "stringArray"] as const;

const slugSchema = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const connectorIdSchema = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);
const templateSchema = z.string().min(1).max(300);

export const restArgSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,60}$/),
    /** Where the value goes. Path args are percent-encoded into the path template's `{key}` placeholder. */
    in: z.enum(["path", "query", "body"]),
    type: z.enum(REST_ARG_TYPES).default("string"),
    required: z.boolean(),
    /** Generated content (a message, a title, a description) the agent writes; everything else must be pinned. */
    freeText: z.boolean().optional(),
    /**
     * For body args: dotted location in the JSON body, e.g. `fields.Name` or `message.0.content`. Numeric segments
     * create arrays. Defaults to the key itself. For query args: the query parameter name (defaults to the key).
     */
    target: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(200),
  })
  .strict();
export type RestArgSpec = z.infer<typeof restArgSchema>;

export const restOperationSchema = z
  .object({
    slug: slugSchema,
    /** One line, shown to developers and reviewers: what the call does and that it does nothing else. */
    summary: z.string().min(1).max(200),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** Path after the base path, beginning with "/". `{arg}` placeholders must be declared path args. */
    path: z.string().regex(/^\/[A-Za-z0-9_\-./{}:@$~]*$/),
    sideEffect: z.enum(["read", "write_create", "write_update", "write_delete"]),
    /** What kind of thing the call targets, e.g. "project", "issue", "contact". */
    resourceType: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),
    /**
     * The argument that identifies the target; capabilities bind to its value. Must be a required, non-free-text
     * argument. Omit for account-wide calls (e.g. "list projects"), which bind to the connection as a whole.
     */
    resource: z.string().optional(),
    args: z.array(restArgSchema).max(15).default([]),
    /** Body encoding for body args; form is `application/x-www-form-urlencoded` with flat keys. */
    body: z.enum(["json", "form"]).default("json"),
    /** Constant query parameters/body fields, never overridable by an argument. */
    fixedQuery: z.record(z.string(), z.string()).optional(),
    fixedBody: z.record(z.string(), z.unknown()).optional(),
    dataSensitivity: z.enum(["public", "internal", "confidential", "secret"]).default("internal"),
    /** Sends something outside the organization (an email, an SMS, a public post). */
    externalCommunication: z.boolean().default(false),
    /** Moves money or changes what someone is charged. */
    financialImpact: z.boolean().default(false),
  })
  .strict();
export type RestOperationSpec = z.infer<typeof restOperationSchema>;

export const restConfigFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
    label: z.string().min(1).max(80),
    placeholder: z.string().max(120).optional(),
    help: z.string().max(200).optional(),
    /** Anchored regular expression the value must match (checked on save and on every use). */
    pattern: z.string().min(2).max(200),
  })
  .strict();
export type RestConfigField = z.infer<typeof restConfigFieldSchema>;

export const restCategorySchema = z.enum([
  "Communication",
  "Developer tools",
  "Project management",
  "Productivity",
  "CRM & sales",
  "Customer support",
  "Marketing & email",
  "Analytics",
  "Commerce & payments",
  "Finance & accounting",
  "HR & recruiting",
  "Content & design",
  "Cloud & infrastructure",
  "AI & ML",
  "Data & storage",
]);
export type RestCategory = z.infer<typeof restCategorySchema>;

export const restConnectorSpecSchema = z
  .object({
    id: connectorIdSchema,
    name: z.string().min(1).max(60),
    /** One sentence for the catalog card: what Authority can do with it. */
    description: z.string().min(1).max(160),
    category: restCategorySchema,
    /** The provider's official API reference this spec was written against. */
    docsUrl: z.string().url(),
    /** Simple Icons slug for the logo, when it has one (https://simpleicons.org). */
    iconSlug: z
      .string()
      .regex(/^[a-z0-9]+$/)
      .optional(),
    /** A literal hostname, or a literal suffix with `{config.<field>}` as the first DNS label. */
    host: z
      .string()
      .regex(
        /^(\{config\.[a-z][a-z0-9_]*\}\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      ),
    basePath: z
      .string()
      .regex(/^(\/[A-Za-z0-9_\-.{}]+)*$/)
      .default(""),
    credential: z
      .object({
        /** What the dashboard calls the secret, e.g. "API key", "Personal access token". */
        label: z.string().min(1).max(60),
        /** Where to create one, shown under the input. */
        help: z.string().min(1).max(240),
        placeholder: z.string().max(80).optional(),
      })
      .strict(),
    auth: z
      .object({
        headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), templateSchema).optional(),
        basic: z
          .object({ username: templateSchema, password: z.string().max(300) })
          .strict()
          .optional(),
        query: z.record(z.string().regex(/^[A-Za-z0-9_.-]+$/), templateSchema).optional(),
      })
      .strict(),
    /** Non-secret constant headers, e.g. an API version. */
    headers: z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().max(200)).optional(),
    configFields: z.array(restConfigFieldSchema).max(3).default([]),
    /** A cheap authenticated read used to verify the credential (2xx = verified). */
    verify: z
      .object({
        method: z.enum(["GET", "POST"]),
        path: z.string().regex(/^\/[A-Za-z0-9_\-./{}:@$~?=&]*$/),
        body: z.string().max(500).optional(),
      })
      .strict(),
    operations: z.array(restOperationSchema).min(1).max(8),
  })
  .strict();
export type RestConnectorSpec = z.input<typeof restConnectorSpecSchema>;
export type ParsedRestConnectorSpec = z.output<typeof restConnectorSpecSchema>;

const TEMPLATE_VAR = /\{([^}]+)\}/g;

/** Every `{...}` placeholder in a template. */
export function templateVars(template: string): string[] {
  return [...template.matchAll(TEMPLATE_VAR)].map((m) => m[1]!);
}

/**
 * Structural rules a zod schema can't express. Returns problems (empty = valid); spec tests assert none for every
 * shipped provider.
 */
export function specProblems(input: RestConnectorSpec): string[] {
  const parsed = restConnectorSpecSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const spec = parsed.data;
  const problems: string[] = [];
  const configKeys = new Set(spec.configFields.map((f) => f.key));
  for (const f of spec.configFields) {
    try {
      new RegExp(f.pattern);
    } catch {
      problems.push(`configFields.${f.key}: pattern is not a valid regular expression`);
    }
    if (!f.pattern.startsWith("^") || !f.pattern.endsWith("$")) {
      problems.push(`configFields.${f.key}: pattern must be anchored with ^...$`);
    }
  }
  const checkTemplate = (where: string, template: string, allowKey: boolean) => {
    for (const v of templateVars(template)) {
      if (v === "key" && allowKey) continue;
      if (v.startsWith("config.") && configKeys.has(v.slice(7))) continue;
      problems.push(`${where}: unknown placeholder {${v}}`);
    }
  };
  checkTemplate("host", spec.host, false);
  checkTemplate("basePath", spec.basePath, false);
  for (const [h, t] of Object.entries(spec.auth.headers ?? {})) checkTemplate(`auth.headers.${h}`, t, true);
  for (const [q, t] of Object.entries(spec.auth.query ?? {})) checkTemplate(`auth.query.${q}`, t, true);
  if (spec.auth.basic) {
    checkTemplate("auth.basic.username", spec.auth.basic.username, true);
    checkTemplate("auth.basic.password", spec.auth.basic.password, true);
  }
  const authUsesKey = [
    ...Object.values(spec.auth.headers ?? {}),
    ...Object.values(spec.auth.query ?? {}),
    spec.auth.basic?.username ?? "",
    spec.auth.basic?.password ?? "",
  ].some((t) => t.includes("{key}"));
  if (!authUsesKey) problems.push("auth: the stored credential ({key}) is never sent");
  checkTemplate("verify.path", spec.verify.path, false);

  const slugs = new Set<string>();
  for (const op of spec.operations) {
    const where = `operations.${op.slug}`;
    if (slugs.has(op.slug)) problems.push(`${where}: duplicate slug`);
    slugs.add(op.slug);
    const keys = new Set<string>();
    for (const a of op.args) {
      if (keys.has(a.key)) problems.push(`${where}.${a.key}: duplicate argument`);
      keys.add(a.key);
      if (a.in === "path" && !a.required) problems.push(`${where}.${a.key}: path arguments must be required`);
      if (a.in === "path" && a.type !== "string" && a.type !== "number")
        problems.push(`${where}.${a.key}: path arguments must be strings or numbers`);
      if (a.in === "path" && a.freeText)
        problems.push(`${where}.${a.key}: a path argument cannot be free text`);
      if (a.in === "body" && op.method === "GET") problems.push(`${where}.${a.key}: GET cannot carry a body`);
      if (a.in === "body" && op.body === "form" && a.target?.includes("."))
        problems.push(`${where}.${a.key}: form bodies are flat`);
      if (a.type === "stringArray" && a.in !== "body")
        problems.push(`${where}.${a.key}: arrays only go in the body`);
    }
    const pathVars = templateVars(op.path);
    for (const v of pathVars) {
      const arg = op.args.find((a) => a.key === v);
      if (!arg || arg.in !== "path")
        problems.push(`${where}: path placeholder {${v}} is not a path argument`);
    }
    for (const a of op.args) {
      if (a.in === "path" && !pathVars.includes(a.key))
        problems.push(`${where}.${a.key}: path argument not in path`);
    }
    if (op.resource !== undefined) {
      const arg = op.args.find((a) => a.key === op.resource);
      if (!arg) problems.push(`${where}: resource "${op.resource}" is not an argument`);
      else if (!arg.required || arg.freeText || arg.type === "stringArray")
        problems.push(`${where}: resource "${op.resource}" must be a required, pinned scalar`);
    }
    if (op.sideEffect !== "read" && op.method === "GET") problems.push(`${where}: a write cannot be a GET`);
    if (op.sideEffect === "read" && op.method === "DELETE")
      problems.push(`${where}: a read cannot be a DELETE`);
    if (op.sideEffect === "write_delete" && op.method !== "DELETE" && op.method !== "POST")
      problems.push(`${where}: deletes use DELETE (or POST for RPC-style APIs)`);
    for (const fixed of Object.keys(op.fixedQuery ?? {})) {
      if (op.args.some((a) => a.in === "query" && (a.target ?? a.key) === fixed))
        problems.push(`${where}: query argument overrides fixed query "${fixed}"`);
    }
    for (const fixed of Object.keys(op.fixedBody ?? {})) {
      if (op.args.some((a) => a.in === "body" && (a.target ?? a.key).split(".")[0] === fixed))
        problems.push(`${where}: body argument overlaps fixed body "${fixed}"`);
    }
  }
  return problems;
}
