import { agentSchema, type Agent } from "@/lib/domain";
import type { Database } from "@/lib/supabase/database.types";

import { throwInvalidRow } from "../errors";
import type { InsertRow, Tables } from "../db-types";

/**
 * Database row → domain `Agent`.
 *
 * `description`, `model_provider`, `environment`, `risk_tier`, `demo_key`
 * and `updated_at` are database-only product metadata, dropped here. The
 * domain `Agent` is exactly the seven fields Part 1 defined: identity,
 * `model`/`framework`, the owning principal, `status`, `createdAt`.
 */
export function agentRowToDomain(row: Tables<"agents">): Agent {
  const result = agentSchema.safeParse({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    model: row.model,
    framework: row.framework,
    ownerPrincipalId: row.owner_principal_id,
    status: row.status,
    createdAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("agent", row.id, result.error);
  return result.data;
}

/**
 * Fields required to create an agent. Wider than the domain `Agent` type —
 * `modelProvider` is a mandatory database column with no domain equivalent,
 * and `description`/`environment`/`riskTier` are optional product metadata
 * the database defaults if omitted.
 */
export interface CreateAgentInput {
  tenantId: string;
  name: string;
  model: string;
  framework: string;
  ownerPrincipalId: string;
  modelProvider: string;
  description?: string;
  environment?: Database["public"]["Enums"]["tenant_environment"];
  riskTier?: Database["public"]["Enums"]["agent_risk_tier"];
  status?: Agent["status"];
}

export function agentInputToInsertRow(input: CreateAgentInput): InsertRow<"agents"> {
  return {
    tenant_id: input.tenantId,
    name: input.name,
    model: input.model,
    framework: input.framework,
    owner_principal_id: input.ownerPrincipalId,
    model_provider: input.modelProvider,
    description: input.description ?? null,
    environment: input.environment,
    risk_tier: input.riskTier,
    status: input.status,
  };
}
