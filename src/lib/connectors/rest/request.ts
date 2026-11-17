import {
  restConnectorSpecSchema,
  specProblems,
  templateVars,
  type ParsedRestConnectorSpec,
  type RestConnectorSpec,
  type RestOperationSpec,
} from "./spec";

/**
 * Pure request planning for declarative REST connectors: from a spec, an operation, the agent's arguments, the
 * connection's settings and the stored secret to the exact HTTP request. No I/O, so every rule is unit-testable.
 */

const MAX_STRING = 20_000;
const MAX_ARRAY = 50;
const DNS_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class RestRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestRequestError";
  }
}

export interface PlannedRestRequest {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
  resource: string;
  isWrite: boolean;
}

/** Parses and checks a spec once; throws if it is malformed, so a bad spec never registers. */
export function parseSpec(input: RestConnectorSpec): ParsedRestConnectorSpec {
  const problems = specProblems(input);
  if (problems.length > 0)
    throw new Error(`Invalid REST connector spec "${input.id}": ${problems.join("; ")}`);
  return restConnectorSpecSchema.parse(input);
}

export function operationFor(spec: ParsedRestConnectorSpec, tool: string): RestOperationSpec {
  const dot = tool.indexOf(".");
  if (dot <= 0 || tool.slice(0, dot) !== spec.id)
    throw new RestRequestError(`"${tool}" is not a ${spec.name} tool.`);
  const slug = tool.slice(dot + 1);
  const op = spec.operations.find((o) => o.slug === slug);
  if (!op) throw new RestRequestError(`${spec.name} connector does not implement "${tool}".`);
  return op;
}

/** Checks the agent's arguments against the operation: no undeclared keys, required present, right types. */
export function validateArgs(op: RestOperationSpec, input: unknown): Record<string, unknown> {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) {
    throw new RestRequestError("Arguments must be an object.");
  }
  const args = (input ?? {}) as Record<string, unknown>;
  const declared = new Map(op.args.map((a) => [a.key, a]));
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) throw new RestRequestError(`"${key}" is not an argument of ${op.slug}.`);
  }
  const out: Record<string, unknown> = {};
  for (const arg of op.args) {
    const value = args[arg.key];
    if (value === undefined || value === null) {
      if (arg.required) throw new RestRequestError(`"${arg.key}" is required.`);
      continue;
    }
    switch (arg.type) {
      case "string":
        if (typeof value !== "string") throw new RestRequestError(`"${arg.key}" must be a string.`);
        if (value.length > MAX_STRING) throw new RestRequestError(`"${arg.key}" is too long.`);
        if (arg.required && value.length === 0) throw new RestRequestError(`"${arg.key}" must not be empty.`);
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new RestRequestError(`"${arg.key}" must be a finite number.`);
        break;
      case "boolean":
        if (typeof value !== "boolean") throw new RestRequestError(`"${arg.key}" must be true or false.`);
        break;
      case "stringArray":
        if (
          !Array.isArray(value) ||
          value.length > MAX_ARRAY ||
          value.some((v) => typeof v !== "string" || v.length > MAX_STRING)
        ) {
          throw new RestRequestError(`"${arg.key}" must be a list of at most ${MAX_ARRAY} strings.`);
        }
        break;
    }
    out[arg.key] = value;
  }
  return out;
}

/** The resource a capability binds to: the identifying argument's value, or the account for account-wide calls. */
export function resourceFor(op: RestOperationSpec, args: Record<string, unknown>): string {
  return op.resource === undefined ? "account" : String(args[op.resource]);
}

/** Validated connection settings, or a definite error naming the first bad one. */
export function configValues(
  spec: ParsedRestConnectorSpec,
  config: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  const hostField = spec.host.startsWith("{config.") ? spec.host.slice(8, spec.host.indexOf("}")) : null;
  for (const field of spec.configFields) {
    const value = config[field.key];
    if (typeof value !== "string" || !new RegExp(field.pattern).test(value)) {
      throw new RestRequestError(`CONFIG_INVALID:${field.key}`);
    }
    if (field.key === hostField && !DNS_LABEL.test(value))
      throw new RestRequestError(`CONFIG_INVALID:${field.key}`);
    if (/[\r\n]/.test(value)) throw new RestRequestError(`CONFIG_INVALID:${field.key}`);
    values[field.key] = value;
  }
  return values;
}

function fill(
  template: string,
  vars: { key?: string; config: Record<string, string> },
  encode: boolean,
): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    let value: string | undefined;
    if (name === "key") value = vars.key;
    else if (name.startsWith("config.")) value = vars.config[name.slice(7)];
    if (value === undefined) throw new RestRequestError(`Template placeholder {${name}} has no value.`);
    return encode ? encodeURIComponent(value) : value;
  });
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let node: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const last = i === parts.length - 1;
    const key: string | number = /^\d+$/.test(part) ? Number(part) : part;
    if (last) {
      (node as Record<string | number, unknown>)[key] = value;
      return;
    }
    const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
    const existing = (node as Record<string | number, unknown>)[key];
    if (existing === undefined) {
      const created: Record<string, unknown> | unknown[] = nextIsIndex ? [] : {};
      (node as Record<string | number, unknown>)[key] = created;
      node = created;
    } else {
      node = existing as Record<string, unknown> | unknown[];
    }
  }
}

/** The exact HTTP request for one call. `secret` is only ever placed where the spec's auth block says. */
export function planRestRequest(
  spec: ParsedRestConnectorSpec,
  op: RestOperationSpec,
  args: Record<string, unknown>,
  connection: { config: Record<string, unknown>; secret: string },
): PlannedRestRequest {
  if (/[\r\n]/.test(connection.secret)) throw new RestRequestError("CREDENTIAL_INVALID");
  const config = configValues(spec, connection.config);
  const host = fill(spec.host, { config }, false);
  if (!/^[a-z0-9.-]+$/.test(host)) throw new RestRequestError("CONFIG_INVALID:host");
  const basePath = fill(spec.basePath, { config }, true);

  const path = op.path.replace(/\{([a-z][a-z0-9_]*)\}/g, (_m, key: string) => {
    const raw = String(args[key]);
    if (raw === "" || raw === "." || raw === "..")
      throw new RestRequestError(`"${key}" is not a valid identifier.`);
    return encodeURIComponent(raw);
  });

  const url = new URL(`https://${host}${basePath}${path}`);
  if (url.hostname !== host || url.protocol !== "https:") throw new RestRequestError("Destination mismatch.");
  for (const [name, value] of Object.entries(op.fixedQuery ?? {})) url.searchParams.set(name, value);
  for (const arg of op.args) {
    if (arg.in !== "query" || args[arg.key] === undefined) continue;
    url.searchParams.set(arg.target ?? arg.key, String(args[arg.key]));
  }
  for (const [name, template] of Object.entries(spec.auth.query ?? {})) {
    url.searchParams.set(name, fill(template, { key: connection.secret, config }, false));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  for (const [name, value] of Object.entries(spec.headers ?? {})) headers[name.toLowerCase()] = value;
  for (const [name, template] of Object.entries(spec.auth.headers ?? {})) {
    headers[name.toLowerCase()] = fill(template, { key: connection.secret, config }, false);
  }
  if (spec.auth.basic) {
    const user = fill(spec.auth.basic.username, { key: connection.secret, config }, false);
    const pass = fill(spec.auth.basic.password, { key: connection.secret, config }, false);
    headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;
  }

  const bodyArgs = op.args.filter((a) => a.in === "body" && args[a.key] !== undefined);
  let body: string | undefined;
  if (bodyArgs.length > 0 || op.fixedBody) {
    if (op.body === "form") {
      const form = new URLSearchParams();
      for (const [name, value] of Object.entries(op.fixedBody ?? {})) form.append(name, String(value));
      for (const arg of bodyArgs) {
        const value = args[arg.key];
        const name = arg.target ?? arg.key;
        if (Array.isArray(value)) for (const v of value) form.append(name, v);
        else form.append(name, String(value));
      }
      body = form.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    } else {
      const json = structuredClone(op.fixedBody ?? {}) as Record<string, unknown>;
      for (const arg of bodyArgs) setPath(json, arg.target ?? arg.key, args[arg.key]);
      body = JSON.stringify(json);
      headers["content-type"] = "application/json";
    }
  }

  return {
    url,
    method: op.method,
    headers,
    body,
    resource: resourceFor(op, args),
    isWrite: op.sideEffect !== "read",
  };
}

/** The verify request: the spec's cheap authenticated read, with the same auth as every call. */
export function planVerifyRequest(
  spec: ParsedRestConnectorSpec,
  connection: { config: Record<string, unknown>; secret: string },
): PlannedRestRequest {
  const config = configValues(spec, connection.config);
  const [rawPath, rawQuery] = spec.verify.path.split("?");
  const verifyOp: RestOperationSpec = {
    slug: "verify",
    summary: "verify",
    method: spec.verify.method,
    path: fill(rawPath!, { config }, true),
    sideEffect: "read",
    resourceType: "account",
    args: [],
    body: "json",
    dataSensitivity: "internal",
    externalCommunication: false,
    financialImpact: false,
    fixedQuery: Object.fromEntries(new URLSearchParams(rawQuery ?? "")),
  };
  const planned = planRestRequest(spec, verifyOp, {}, connection);
  if (spec.verify.body) {
    planned.body = spec.verify.body;
    planned.headers["content-type"] = "application/json";
  }
  return planned;
}

/** Placeholders a spec's host/base path/auth use, so the dashboard knows which settings are required. */
export function requiredConfigKeys(spec: ParsedRestConnectorSpec): string[] {
  const all = [
    spec.host,
    spec.basePath,
    ...Object.values(spec.auth.headers ?? {}),
    ...Object.values(spec.auth.query ?? {}),
    spec.auth.basic?.username ?? "",
    spec.auth.basic?.password ?? "",
  ].flatMap(templateVars);
  return [...new Set(all.filter((v) => v.startsWith("config.")).map((v) => v.slice(7)))];
}
