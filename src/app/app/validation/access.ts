import { TENANT_ROLE_RANK, type TenantRole } from "@/lib/domain/common";

export const canRunValidation = (role: TenantRole) => TENANT_ROLE_RANK[role] >= TENANT_ROLE_RANK.developer;
export const canDecideRemediation = (role: TenantRole) =>
  TENANT_ROLE_RANK[role] >= TENANT_ROLE_RANK.security_admin;
