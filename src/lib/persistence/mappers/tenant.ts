import { tenantSchema, type Tenant } from "@/lib/domain";

import { throwInvalidRow } from "../errors";
import type { Tables } from "../db-types";

/**
 * Database row → domain `Tenant`.
 *
 * The `tenants` table (Part 2A) carries `environment`, `created_by` and
 * `updated_at`, none of which are part of the Part 1 domain schema. They are
 * dropped here rather than added to `tenantSchema` — the domain stays
 * exactly as narrow as Part 1 defined it; the extra columns exist for the
 * application-level tenant-selection UI in `lib/auth/`, a different concern
 * entirely from this seam.
 */
export function tenantRowToDomain(row: Tables<"tenants">): Tenant {
  const result = tenantSchema.safeParse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
  });

  if (!result.success) throwInvalidRow("tenant", row.id, result.error);
  return result.data;
}
