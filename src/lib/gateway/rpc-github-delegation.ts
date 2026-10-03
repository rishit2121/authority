import "server-only";

import { gatewayQuery } from "./db";
import type { DeveloperApiStatus } from "./rpc-customers";

type Row = Record<string, unknown>;

export interface CustomerGithubRepository {
  repositoryId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface ListCustomerGithubRepositoriesResult {
  status: DeveloperApiStatus;
  repositories: CustomerGithubRepository[];
}

/** Every repository delegated to this customer (admin-granted, see delegate_github_repository_to_customer) -- the discovery step before binding one to a task. */
export async function listCustomerGithubRepositoriesForBackend(
  secret: string,
  customerId: string,
): Promise<ListCustomerGithubRepositoriesResult> {
  const rows = await gatewayQuery<Row>(
    `select * from gateway.list_customer_github_repositories_for_backend($1, $2::uuid)`,
    [secret, customerId],
  );
  const status = (rows[0]?.lcgr_status as string) ?? "unknown";
  if (status !== "ok") return { status, repositories: [] };
  return {
    status,
    repositories: rows
      .filter((r) => r.lcgr_repository_id != null)
      .map((r) => ({
        repositoryId: r.lcgr_repository_id as string,
        owner: r.lcgr_owner as string,
        name: r.lcgr_name as string,
        defaultBranch: r.lcgr_default_branch as string,
        isPrivate: Boolean(r.lcgr_is_private),
      })),
  };
}

/**
 * Binds a task to a repository delegated to that task's own customer.
 * GitHub repositories are never represented as `connector_connections`
 * rows (see 20261003000015_github_customer_delegation.sql's own module
 * comment on why) -- this is a separate, explicit step from
 * `createCustomerTask`, matching how a human developer already binds a
 * repository to a task as a distinct dashboard action, not part of task
 * creation itself.
 */
export async function bindTaskGithubRepositoryForBackend(input: {
  credentialSecret: string;
  taskId: string;
  repositoryId: string;
}): Promise<DeveloperApiStatus> {
  const rows = await gatewayQuery<{ github_bind_task_repository_for_backend: string }>(
    `select gateway.github_bind_task_repository_for_backend($1, $2::uuid, $3::uuid) as github_bind_task_repository_for_backend`,
    [input.credentialSecret, input.taskId, input.repositoryId],
  );
  return rows[0].github_bind_task_repository_for_backend;
}
