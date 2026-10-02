import "server-only";

/** One field in a custom operation's input_schema (see the migration's own doc comment for the JSON shape). */
export interface CustomOperationField {
  key: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  identifiesResource: boolean;
  /** Where this field's value is placed when the request is built. Never "header" — agents cannot supply arbitrary headers. */
  in: "path" | "query" | "body";
}

export interface CustomOperationInputSchema {
  schemaVersion: 1;
  fields: CustomOperationField[];
}

/** Static, non-secret extras an admin configured at authoring time — never agent-controlled, never a script. */
export interface CustomOperationRequestMapping {
  schemaVersion: 1;
  staticHeaders?: Array<{ name: string; value: string }>;
  staticQuery?: Array<{ name: string; value: string }>;
}

export type CustomOperationAuthType = "none" | "bearer" | "api_key_header" | "basic";

export interface CustomOperationAuthConfig {
  schemaVersion: 1;
  /** Only meaningful for api_key_header. */
  headerName?: string;
}

export interface CustomOperationDefinitionRow {
  id: string;
  tenantId: string;
  connectionId: string;
  operationSlug: string;
  toolName: string;
  name: string;
  description: string | null;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  inputSchema: CustomOperationInputSchema;
  requestMapping: CustomOperationRequestMapping;
  authType: CustomOperationAuthType;
  authConfig: CustomOperationAuthConfig;
  timeoutMs: number;
  invocationLimit: number | null;
  status: "draft" | "validated" | "published" | "retired";
}

export class CustomOperationValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomOperationValidationError";
  }
}

/** Headers an operation definition or a tool argument may never set — transport-sensitive, or the agent/provider auth boundary itself. */
export const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "proxy-authorization",
  "authorization", // set only by this connector's own auth resolution, never by static config or agent input
]);
