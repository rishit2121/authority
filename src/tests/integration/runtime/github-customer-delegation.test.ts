import { createHash, randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  bindTaskGithubRepositoryForBackend,
  listCustomerGithubRepositoriesForBackend,
} from "@/lib/gateway/rpc-github-delegation";
import { createCustomerTask, createOrResolveCustomer } from "@/lib/gateway/rpc-customers";

import { createGatewayFixture, ensureMockInstallation, type GatewayFixture } from "../gateway-support";
import { managementQuery, TENANT_A_ID } from "../support";

/**
 * Proves GitHub's new customer-delegation layer added in
 * 20261003000015_github_customer_delegation.sql: a repository is usable
 * through the backend-credential API only once explicitly delegated to the
 * task's own customer -- never implicitly from the tenant's allowlist alone
 * -- while the pre-existing dashboard path
 * (public.github_bind_task_repository, exercised elsewhere) keeps working
 * unchanged, since both now share the same core.
 */

const BACKEND_SECRET_PREFIX = "authority_dk_";

function mintBackendSecret(): { plaintext: string; hash: string } {
  const plaintext = `${BACKEND_SECRET_PREFIX}${randomBytes(32).toString("hex")}`;
  return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
}

interface AppFixture {
  applicationId: string;
  backendSecret: string;
  cleanup: () => Promise<void>;
}

async function createApplicationFixture(suffix: string): Promise<AppFixture> {
  const applicationId = `cccc0000-0000-4000-8000-${suffix}0000`;
  const { plaintext, hash } = mintBackendSecret();
  const keyPrefix = plaintext.slice(0, 21);

  await managementQuery(`
    insert into public.applications (id, tenant_id, name, slug)
    values ('${applicationId}', '${TENANT_A_ID}', 'GitHub delegation test app', 'ghd-${suffix}');

    insert into public.developer_backend_credentials (tenant_id, application_id, key_prefix, key_hash)
    values ('${TENANT_A_ID}', '${applicationId}', '${keyPrefix}', '${hash}');
  `);

  return {
    applicationId,
    backendSecret: plaintext,
    cleanup: async () => {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.developer_backend_credentials where application_id = '${applicationId}';
        delete from public.customers where application_id = '${applicationId}';
        delete from public.applications where id = '${applicationId}';
      `);
    },
  };
}

async function repositoryIdFor(fullName: string): Promise<string> {
  const [owner, name] = fullName.split("/");
  const rows = (await managementQuery(
    `select id from public.github_repositories where tenant_id = '${TENANT_A_ID}' and owner = '${owner}' and name = '${name}';`,
  )) as Array<{ id: string }>;
  if (!rows[0]) throw new Error(`fixture repository ${fullName} not found`);
  return rows[0].id;
}

async function delegateRepository(repositoryId: string, customerId: string): Promise<void> {
  await managementQuery(`
    insert into public.github_repository_customer_delegations (tenant_id, repository_id, customer_id)
    values ('${TENANT_A_ID}', '${repositoryId}', '${customerId}');
  `);
}

describe("GitHub repository customer delegation (real database)", () => {
  const apps: AppFixture[] = [];
  const taskIds: string[] = [];
  const fixtures: GatewayFixture[] = [];

  afterEach(async () => {
    for (const taskId of taskIds.splice(0, taskIds.length)) {
      await managementQuery(`
        set local role postgres;
        select set_config('authority.allow_demo_purge', 'on', true);
        delete from public.task_repository_bindings where task_id = '${taskId}';
        delete from public.tasks where id = '${taskId}';
      `);
    }
    // Must precede `apps` cleanup: delegations reference customers, which
    // that cleanup deletes.
    await managementQuery(`
      set local role postgres;
      select set_config('authority.allow_demo_purge', 'on', true);
      delete from public.github_repository_customer_delegations where tenant_id = '${TENANT_A_ID}';
    `);
    while (apps.length > 0) {
      await apps.pop()?.cleanup();
    }
    while (fixtures.length > 0) {
      await fixtures.pop()?.cleanup();
    }
  });

  const mkAgent = async (label: string) => {
    const fx = await createGatewayFixture({ label });
    fixtures.push(fx);
    return fx;
  };

  it("lists only repositories explicitly delegated to this customer, and binds one to a task", async () => {
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/widgets");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const alex = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "alex" });
    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });

    const beforeDelegation = await listCustomerGithubRepositoriesForBackend(
      app.backendSecret,
      alex.customerId!,
    );
    expect(beforeDelegation.status).toBe("ok");
    expect(beforeDelegation.repositories).toEqual([]);

    await delegateRepository(repoId, alex.customerId!);

    const afterDelegation = await listCustomerGithubRepositoriesForBackend(
      app.backendSecret,
      alex.customerId!,
    );
    expect(afterDelegation.repositories.map((r) => r.repositoryId)).toEqual([repoId]);
    expect(afterDelegation.repositories[0].owner).toBe("acme");
    expect(afterDelegation.repositories[0].name).toBe("widgets");

    // Bob never had it delegated -- still sees nothing.
    const bobList = await listCustomerGithubRepositoriesForBackend(app.backendSecret, bob.customerId!);
    expect(bobList.repositories).toEqual([]);

    const agent = await mkAgent("github-delegation-alex");
    const task = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: alex.customerId!,
      agentId: agent.agentId,
      intent: "Read an issue in acme/widgets",
      connectorBindings: [],
    });
    expect(task.status).toBe("ok");
    taskIds.push(task.taskId!);

    const bindResult = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(bindResult).toBe("ok");

    const bound = (await managementQuery(
      `select repository_id from public.task_repository_bindings where task_id = '${task.taskId}';`,
    )) as Array<{ repository_id: string }>;
    expect(bound[0]?.repository_id).toBe(repoId);

    // Binding again is refused, not silently repeated.
    const secondBind = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(secondBind).toBe("already_bound");
  });

  it("refuses to bind a repository never delegated to this customer", async () => {
    await ensureMockInstallation();
    const repoId = await repositoryIdFor("acme/fault-write-timeout");

    const suffix = randomBytes(4).toString("hex");
    const app = await createApplicationFixture(suffix);
    apps.push(app);

    const bob = await createOrResolveCustomer({ credentialSecret: app.backendSecret, externalId: "bob" });
    const agent = await mkAgent("github-delegation-bob");

    const task = await createCustomerTask({
      credentialSecret: app.backendSecret,
      customerId: bob.customerId!,
      agentId: agent.agentId,
      intent: "Read an issue",
      connectorBindings: [],
    });
    taskIds.push(task.taskId!);

    const bindResult = await bindTaskGithubRepositoryForBackend({
      credentialSecret: app.backendSecret,
      taskId: task.taskId!,
      repositoryId: repoId,
    });
    expect(bindResult).toBe("repository_not_usable_by_customer");

    const bound = await managementQuery(
      `select 1 from public.task_repository_bindings where task_id = '${task.taskId}';`,
    );
    expect(bound).toEqual([]);
  });
});
