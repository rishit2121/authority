"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { toCustomApiConnectorId } from "@/lib/connectors/custom-api/connection-id";
import { buildRequest } from "@/lib/connectors/custom-api/request-builder";
import {
  CustomOperationValidationError,
  type CustomOperationAuthType,
  type CustomOperationField,
} from "@/lib/connectors/custom-api/types";
import { validateOperationDefinition } from "@/lib/connectors/custom-api/validate";
import { createConnectorConnection, disconnectConnectorConnection } from "@/lib/gateway/rpc-connectors";
import {
  getConnectorConnectionConfig,
  setConnectorSecret,
  updateConnectorConnectionConfig,
  type ConnectorSecretType,
} from "@/lib/gateway/rpc-connector-secrets";
import {
  createCustomOperationDraft,
  deleteCustomOperationDraft,
  publishCustomOperation,
  retireCustomOperation,
  validateCustomOperation,
} from "@/lib/gateway/rpc-custom-operations";
import { createRepositoriesForCurrentTenant } from "@/lib/persistence/current-tenant";
import { removeConnection } from "@/lib/persistence/remove-connection";

export interface CustomApiActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const PAGE = "/app/integrations/custom-api";

const FRIENDLY: Record<string, string> = {
  forbidden: "Your role does not allow this. An admin is required.",
  already_connected: "A connection with that id already exists.",
  not_found: "That record was not found.",
  connection_not_found: "That connection was not found or is disconnected.",
  no_draft: "There is no draft operation to act on.",
  not_draft: "This operation is no longer a draft and cannot be edited.",
  not_validated: "Validate the operation before publishing it.",
  not_published: "Only a published operation can be retired.",
  has_dependents: "This draft cannot be deleted.",
};
const friendly = (code: string) => FRIENDLY[code] ?? "The request could not be completed.";

export async function createCustomApiConnectionAction(
  name: string,
  baseUrl: string,
): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const connectionId = randomUUID();
  const connectorId = toCustomApiConnectorId(connectionId);
  const created = await createConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectorId,
    name,
    environment: "development",
    connectionId,
  });
  if (created.status !== "ok") return { ok: false, error: friendly(created.status) };
  const configured = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { baseUrl },
  });
  revalidatePath(PAGE);
  if (configured !== "ok") return { ok: false, error: friendly(configured) };
  return { ok: true, message: `Connection created (${connectorId}).` };
}

export async function updateCustomApiBaseUrlAction(
  connectionId: string,
  baseUrl: string,
): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const existing = await getConnectorConnectionConfig(connectionId);
  const result = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { ...(existing?.config ?? {}), baseUrl },
  });
  revalidatePath(PAGE);
  return result === "ok"
    ? { ok: true, message: "Base URL updated." }
    : { ok: false, error: friendly(result) };
}

export async function disconnectCustomApiConnectionAction(
  connectionId: string,
): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await disconnectConnectorConnection({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
  });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return {
    ok: true,
    message: `Disconnected; ${result.revokedCapabilities ?? 0} live capabilit${result.revokedCapabilities === 1 ? "y" : "ies"} revoked.`,
  };
}

export async function setCustomApiSecretAction(
  connectionId: string,
  secretType: ConnectorSecretType,
  plaintextSecret: string,
): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await setConnectorSecret({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    secretType,
    plaintextSecret,
  });
  revalidatePath(PAGE);
  return result === "ok"
    ? { ok: true, message: "Credential saved." }
    : { ok: false, error: friendly(result) };
}

export interface CreateOperationInput {
  connectionId: string;
  operationSlug: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  authType: CustomOperationAuthType;
  /** Required, and used, only when authType is "api_key_header" — the header this operation's API key is sent in (e.g. "X-Api-Key"). */
  headerName?: string;
  /** 1-20 fields; see docs/connectors/CUSTOM_API.md for the supported shape. */
  fields: CustomOperationField[];
  /** Fixed, non-secret headers sent on every call to this operation (e.g. Notion's required "Notion-Version") — never a place for a credential; gateway.validate_custom_operation independently refuses "authorization" and a handful of other reserved names here. */
  staticHeaders?: Array<{ name: string; value: string }>;
}

export interface CustomApiValidationResult extends CustomApiActionResult {
  issues?: Array<{ field: string; message: string }>;
}

/**
 * Drafts an operation with an arbitrary (1-20) field list spanning path,
 * query, and body locations -- structurally checked here, before the RPC is
 * even called, by the same rules docs/connectors/CUSTOM_API.md documents and
 * src/lib/connectors/custom-api/request-builder.ts enforces again at
 * execution time. The database's own check (gateway.validate_custom_operation)
 * re-verifies the cheap structural facts independently; it does not trust
 * this call was made correctly.
 */
export async function createCustomOperationAction(
  input: CreateOperationInput,
): Promise<CustomApiValidationResult> {
  const inputSchema = { schemaVersion: 1 as const, fields: input.fields };
  const requestMapping = {
    schemaVersion: 1 as const,
    ...(input.staticHeaders?.length ? { staticHeaders: input.staticHeaders } : {}),
  };
  const structural = validateOperationDefinition({
    pathTemplate: input.pathTemplate,
    inputSchema,
    requestMapping,
  });
  if (!structural.ok) {
    return {
      ok: false,
      error: structural.issues[0]?.message ?? "Invalid operation definition.",
      issues: structural.issues,
    };
  }

  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const draft = await createCustomOperationDraft({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId: input.connectionId,
    operationSlug: input.operationSlug,
    name: input.name,
    description: null,
    method: input.method,
    pathTemplate: input.pathTemplate,
    effect: input.effect,
    inputSchema,
    requestMapping,
    authType: input.authType,
    authConfig:
      input.authType === "api_key_header" && input.headerName
        ? { schemaVersion: 1, headerName: input.headerName }
        : { schemaVersion: 1 },
    timeoutMs: 8000,
    invocationLimit: null,
  });
  revalidatePath(PAGE);
  if (draft.status !== "ok") return { ok: false, error: friendly(draft.status) };
  return { ok: true, message: "Draft created." };
}

export interface PreviewRequestInput {
  baseUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  authType: CustomOperationAuthType;
  headerName?: string;
  fields: CustomOperationField[];
  staticHeaders?: Array<{ name: string; value: string }>;
  /** Raw text as typed in the preview form, keyed by field.key; coerced to each field's declared type before building the request. */
  sampleValues: Record<string, string>;
}

export interface PreviewRequestResult extends CustomApiActionResult {
  preview?: { method: string; url: string; headers: Record<string, string>; body: string | undefined };
}

/**
 * Builds the exact request this operation would send, from sample values
 * typed into the draft form — using the SAME `buildRequest` the real
 * connector calls at execution time (src/lib/connectors/custom-api/
 * request-builder.ts), so a preview can never show a shape the connector
 * would not actually produce. No secret is ever resolved or shown: auth
 * headers are not part of `buildRequest`'s own output (the real connector
 * adds them in a separate step, after this one, only at execution time), so
 * this preview substitutes a label for the auth header instead of a value.
 */
export async function previewCustomOperationAction(
  input: PreviewRequestInput,
): Promise<PreviewRequestResult> {
  if (!input.baseUrl) {
    return { ok: false, error: "Set this connection's base URL before previewing a request." };
  }
  const args: Record<string, unknown> = {};
  for (const field of input.fields) {
    const raw = input.sampleValues[field.key];
    if (raw === undefined || raw === "") continue;
    if (field.type === "number") args[field.key] = Number(raw);
    else if (field.type === "boolean") args[field.key] = raw === "true";
    else args[field.key] = raw;
  }

  try {
    const built = buildRequest(
      {
        connectionId: "preview",
        baseUrl: input.baseUrl,
        method: input.method,
        pathTemplate: input.pathTemplate,
        inputSchema: { schemaVersion: 1, fields: input.fields },
        requestMapping: {
          schemaVersion: 1,
          ...(input.staticHeaders?.length ? { staticHeaders: input.staticHeaders } : {}),
        },
      },
      args,
    );
    const headers = { ...built.headers };
    if (input.authType === "bearer") headers.authorization = "Bearer <resolved at request time>";
    else if (input.authType === "basic") headers.authorization = "Basic <resolved at request time>";
    else if (input.authType === "api_key_header" && input.headerName) {
      headers[input.headerName] = "<resolved at request time>";
    }
    return { ok: true, preview: { method: built.method, url: built.url, headers, body: built.body } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof CustomOperationValidationError
          ? error.message
          : "Could not build a preview with these sample values.",
    };
  }
}

export async function validateCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await validateCustomOperation({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    operationId,
  });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return { ok: true, message: "Validated. An administrator can now publish it." };
}

export async function publishCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await publishCustomOperation({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    operationId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Published. This definition is now immutable." };
}

export async function retireCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await retireCustomOperation({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    operationId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Retired. Existing contracts that already pinned it are unaffected." };
}

export async function deleteCustomOperationDraftAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await deleteCustomOperationDraft({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    operationId,
  });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Draft deleted." };
}

/** Removes a disconnected connection from this page (archived; its history is kept). Admins and owners only. */
export async function removeCustomApiConnectionAction(connectionId: string): Promise<CustomApiActionResult> {
  const { context } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await removeConnection(context, connectionId);
  revalidatePath(PAGE);
  return result;
}
