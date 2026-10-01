"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { toCustomApiConnectorId } from "@/lib/connectors/custom-api/connection-id";
import type { CustomOperationAuthType, CustomOperationField } from "@/lib/connectors/custom-api/types";
import {
  createConnectorConnection,
  disconnectConnectorConnection,
} from "@/lib/gateway/rpc-connectors";
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

export async function createCustomApiConnectionAction(name: string, baseUrl: string): Promise<CustomApiActionResult> {
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

export async function updateCustomApiBaseUrlAction(connectionId: string, baseUrl: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const existing = await getConnectorConnectionConfig(connectionId);
  const result = await updateConnectorConnectionConfig({
    tenantId: identity.tenant.tenantId,
    userId: identity.userId,
    connectionId,
    config: { ...(existing?.config ?? {}), baseUrl },
  });
  revalidatePath(PAGE);
  return result === "ok" ? { ok: true, message: "Base URL updated." } : { ok: false, error: friendly(result) };
}

export async function disconnectCustomApiConnectionAction(connectionId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await disconnectConnectorConnection({ tenantId: identity.tenant.tenantId, userId: identity.userId, connectionId });
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
  return result === "ok" ? { ok: true, message: "Credential saved." } : { ok: false, error: friendly(result) };
}

export interface CreateOperationInput {
  connectionId: string;
  operationSlug: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pathTemplate: string;
  effect: "read" | "write_create" | "write_update" | "write_delete" | "admin";
  authType: CustomOperationAuthType;
  argumentKey: string;
  argumentIn: CustomOperationField["in"];
  argumentType: CustomOperationField["type"];
  argumentRequired: boolean;
}

/**
 * Drafts one operation with exactly one declared argument, which always
 * identifies the capability's bound resource. A full multi-field schema
 * editor is a known limitation of this release -- see the PR description --
 * everything downstream (validation, publication, immutability, execution)
 * already supports an arbitrary field list; only this form is simplified.
 */
export async function createCustomOperationAction(input: CreateOperationInput): Promise<CustomApiActionResult> {
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
    inputSchema: {
      schemaVersion: 1,
      fields: [
        {
          key: input.argumentKey,
          type: input.argumentType,
          required: input.argumentRequired,
          identifiesResource: true,
          in: input.argumentIn,
        },
      ],
    },
    requestMapping: { schemaVersion: 1 },
    authType: input.authType,
    authConfig: { schemaVersion: 1 },
    timeoutMs: 8000,
    invocationLimit: null,
  });
  revalidatePath(PAGE);
  if (draft.status !== "ok") return { ok: false, error: friendly(draft.status) };
  return { ok: true, message: "Draft created." };
}

export async function validateCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await validateCustomOperation({ tenantId: identity.tenant.tenantId, userId: identity.userId, operationId });
  revalidatePath(PAGE);
  if (result.status !== "ok") return { ok: false, error: friendly(result.status) };
  return { ok: true, message: "Validated. An administrator can now publish it." };
}

export async function publishCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await publishCustomOperation({ tenantId: identity.tenant.tenantId, userId: identity.userId, operationId });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Published. This definition is now immutable." };
}

export async function retireCustomOperationAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await retireCustomOperation({ tenantId: identity.tenant.tenantId, userId: identity.userId, operationId });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Retired. Existing contracts that already pinned it are unaffected." };
}

export async function deleteCustomOperationDraftAction(operationId: string): Promise<CustomApiActionResult> {
  const { identity } = await createRepositoriesForCurrentTenant(PAGE);
  const result = await deleteCustomOperationDraft({ tenantId: identity.tenant.tenantId, userId: identity.userId, operationId });
  revalidatePath(PAGE);
  if (result !== "ok") return { ok: false, error: friendly(result) };
  return { ok: true, message: "Draft deleted." };
}
