import "server-only";

/** One field in a postgres query's input_schema (see the migration's own doc comment for the JSON shape). */
export interface PostgresQueryField {
  key: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  identifiesResource: boolean;
}

export interface PostgresQueryInputSchema {
  schemaVersion: 1;
  fields: PostgresQueryField[];
}

export type PostgresQueryEffect = "read" | "write_create" | "write_update" | "write_delete" | "admin";

export interface PostgresQueryDefinitionRow {
  id: string;
  tenantId: string;
  connectionId: string;
  querySlug: string;
  toolName: string;
  name: string;
  description: string | null;
  sqlTemplate: string;
  effect: PostgresQueryEffect;
  inputSchema: PostgresQueryInputSchema;
  timeoutMs: number;
  invocationLimit: number | null;
  status: "draft" | "validated" | "published" | "retired";
  inputSchemaHash: string | null;
  sqlTemplateHash: string | null;
}

export class PostgresQueryValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PostgresQueryValidationError";
  }
}

/** Non-secret connection config stored on `connector_connections.config` -- the password/username live in Vault (basic_password/basic_username). */
export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  sslmode: "require" | "disable";
}
