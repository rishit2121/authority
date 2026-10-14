# @authority/sdk

TypeScript/JavaScript client for [Authority](https://authority-d2zf.onrender.com): give your AI agent only the
access each task needs.

## Install

Install straight from your Authority deployment (Node 20+):

```sh
npm install https://<your-authority-url>/sdk/authority-sdk.tgz
```

## Use

Create an agent on the **Setup** page in the Authority dashboard; it gives you a `.env` with four values.
Then:

```js
import { AuthorityBackendClient, AuthorityAgentClient } from "@authority/sdk";

const url = process.env.AUTHORITY_URL;
const backend = new AuthorityBackendClient({ baseUrl: url, apiKey: process.env.AUTHORITY_BACKEND_API_KEY });
const agent = new AuthorityAgentClient({ baseUrl: url, token: process.env.AUTHORITY_AGENT_RUNTIME_KEY });

const { customerId } = await backend.customers.ensure({ externalId: "user-123" });
const { connections } = await backend.connections.list(customerId);
const { taskId } = await backend.tasks.create({
  customerId,
  agentId: process.env.AUTHORITY_AGENT_ID,
  intent: "List the channels in our Slack workspace",
  connections: connections.map(({ connectorId, connectionId }) => ({ connectorId, connectionId })),
});
await backend.tasks.prepare(taskId, { generate: true }); // "ready" or "awaiting_approval"

const { tools } = await agent.tools.list(taskId); // only what this task was granted
const result = await agent.tools.execute({ taskId, tool: tools[0].tool, arguments: {} });
```

- `AuthorityBackendClient` runs on your server: customers, connections, tasks. Never ship its key to a browser.
- `AuthorityAgentClient` is what your agent uses: list its granted tools and call them. Every call is
  authorized against the task's contract; anything outside it is refused.
- Expected outcomes (`denied`, `requires_approval`, ...) are returned, not thrown. Only failed requests throw
  `AuthorityApiError` (with `status`, `code`, `requestId`) or `AuthorityTimeoutError`.

Full docs: `/docs/quickstart` on your Authority deployment.
