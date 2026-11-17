/**
 * OpenAI tool calling over an `AuthorityTask`. Structural types only -- no dependency on the `openai` package.
 *
 * The adapter only maps schemas: it exposes each allowed action's OPEN inputs (what the model may write) as a
 * function, and turns a model's tool call into `task.call`. Pinned values (a channel, a recipient) come from the
 * task's contract, never from the model, and are left out of the schema. No credential ever enters a schema or a
 * result: the session token stays inside the task handle, the capability token inside one `call`.
 */
import { AuthorityApiError, AuthorityTimeoutError } from "../errors.js";
import type { RequestOptions } from "../http.js";
import { mergePinnedArguments, openOf, pinnedOf, type AuthorityTask, type TaskCallResult } from "../task.js";
import type { ToolManifest, ToolManifestEntry } from "../types.js";

/** Chat Completions / Responses API function tool definition. */
export interface OpenAIFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call as the model returned it: Chat Completions (`function`) or Responses API (`name`/`arguments`). */
export type OpenAIToolCallLike =
  | { id?: string; type?: string; function: { name: string; arguments: string } }
  | { type?: string; call_id?: string; name: string; arguments: string };

export interface HandleOpenAIToolCallOptions {
  /** Required: one stable key per tool call (e.g. `${runId}:${toolCall.id}`). Repeats never act twice. */
  idempotencyKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const OPENAI_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_NAME_LENGTH = 64;

/** "slack.post_message" -> "slack__post_message" (OpenAI names allow only [a-zA-Z0-9_-]). */
export function openAIToolName(tool: string): string {
  return tool.replace(/\./g, "__").replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** FNV-1a, for a short deterministic suffix when a name must be shortened. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

interface Binding {
  name: string;
  entry: ToolManifestEntry;
}

/**
 * One function per allowed action. A tool allowed with several pinned sets (two recipients) becomes several
 * functions (`gmail__send_email__1`, `__2`), each bound to its own pins, so the model never picks a recipient.
 * Deterministic from the manifest, so the reverse mapping is recomputed rather than stored.
 */
function bindingsOf(manifest: ToolManifest): Binding[] {
  const counts = new Map<string, number>();
  for (const entry of manifest.tools) counts.set(entry.tool, (counts.get(entry.tool) ?? 0) + 1);
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return manifest.tools.map((entry) => {
    const index = (seen.get(entry.tool) ?? 0) + 1;
    seen.set(entry.tool, index);
    let name = openAIToolName(entry.tool) + ((counts.get(entry.tool) ?? 1) > 1 ? `__${index}` : "");
    if (name.length > MAX_NAME_LENGTH) name = `${name.slice(0, MAX_NAME_LENGTH - 9)}_${shortHash(name)}`;
    for (let n = 2; used.has(name); n += 1) name = `${name.slice(0, MAX_NAME_LENGTH - 4)}_${n}`;
    used.add(name);
    return { name, entry };
  });
}

function parametersOf(entry: ToolManifestEntry): Record<string, unknown> {
  const schema = entry.inputSchema as { properties?: Record<string, unknown>; required?: unknown };
  const pinned = new Set(entry.resourceConstraints.map((c) => c.key));
  const open = openOf(entry).filter((key) => !pinned.has(key));
  const properties: Record<string, unknown> = {};
  for (const key of open) properties[key] = schema.properties?.[key] ?? { type: "string" };
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string" && open.includes(key))
    : [];
  return { type: "object", properties, required, additionalProperties: false };
}

function descriptionOf(entry: ToolManifestEntry): string {
  const fixed = Object.keys(pinnedOf(entry));
  return fixed.length > 0
    ? `${entry.description} (Authority fixes ${fixed.join(", ")} for this task; do not supply ${fixed.length > 1 ? "them" : "it"}.)`
    : entry.description;
}

/** The manifest is bound to the handle's contract; one fetch per handle. */
const manifests = new WeakMap<AuthorityTask, Promise<ToolManifest>>();
function manifestOf(task: AuthorityTask, options?: RequestOptions): Promise<ToolManifest> {
  let pending = manifests.get(task);
  if (!pending) {
    pending = task.tools(options);
    manifests.set(task, pending);
    const settled = pending;
    settled.catch(() => {
      if (manifests.get(task) === settled) manifests.delete(task);
    });
  }
  return pending;
}

/** OpenAI function tools for every action this task allows, with only the inputs the model may write. */
export async function toOpenAITools(
  task: AuthorityTask,
  options?: RequestOptions,
): Promise<OpenAIFunctionTool[]> {
  const manifest = await manifestOf(task, options);
  return bindingsOf(manifest).map(({ name, entry }) => {
    if (!OPENAI_NAME_RE.test(name)) throw new Error(`internal: invalid OpenAI tool name ${name}`);
    return {
      type: "function",
      function: { name, description: descriptionOf(entry), parameters: parametersOf(entry) },
    };
  });
}

/** What the model sees after a tool call: status and safe text. Never a token, capability or approval URL. */
function modelResult(result: TaskCallResult): Record<string, unknown> {
  const guidance = result.guidance?.message;
  switch (result.status) {
    case "executed":
      return { status: "executed", receiptId: result.receiptId, data: result.data ?? null };
    case "result_held":
      return { status: "result_held", receiptId: result.receiptId, message: result.message };
    case "indeterminate":
      return {
        status: "indeterminate",
        message: "The action may have happened; its outcome is unknown. Do not retry it.",
      };
    case "in_progress":
      return { status: "in_progress", message: "This action is already running. Do not repeat it." };
    case "requires_approval":
    case "held_for_review":
      return {
        status: result.status,
        message:
          "A person must review this action before it can run. Do not retry or change it to avoid review.",
      };
    case "session_expired":
    case "stale_session":
      return { status: result.status, message: "This task can no longer act. Stop and report back." };
    case "cancelled":
      return { status: "cancelled", message: "The action was cancelled before it ran." };
    case "already_authorized":
      return {
        status: "already_authorized",
        message: "This exact action was already requested. Do not repeat it.",
      };
    case "execution_failed":
      return { status: "execution_failed", code: result.code, message: "The action did not run." };
    case "denied":
    case "requires_clarification":
    case "requires_replan":
      return {
        status: result.status,
        reasonCodes: result.reasonCodes,
        summary: result.summary,
        ...(guidance ? { guidance } : {}),
      };
  }
}

/**
 * Run one model tool call through the task and return a JSON string to hand back to the model. Unknown tool
 * names and malformed arguments are answered without a request. A key the model supplies for a pinned argument
 * is sent as given, so the server refuses it -- the adapter never rewrites the model's input.
 */
export async function handleOpenAIToolCall(
  task: AuthorityTask,
  toolCall: OpenAIToolCallLike,
  options: HandleOpenAIToolCallOptions,
): Promise<string> {
  const fn = "function" in toolCall ? toolCall.function : toolCall;
  const requestOptions = { signal: options?.signal, timeoutMs: options?.timeoutMs };
  let manifest: ToolManifest;
  try {
    manifest = await manifestOf(task, requestOptions);
  } catch (error) {
    return JSON.stringify(errorResult(error));
  }
  const binding = bindingsOf(manifest).find((b) => b.name === fn?.name);
  if (!binding) {
    return JSON.stringify({ status: "unknown_tool", message: "This tool is not available for this task." });
  }
  let modelArgs: unknown;
  try {
    modelArgs = fn.arguments === "" || fn.arguments === undefined ? {} : JSON.parse(fn.arguments);
  } catch {
    return JSON.stringify({ status: "invalid_arguments", message: "Tool arguments must be a JSON object." });
  }
  if (modelArgs === null || typeof modelArgs !== "object" || Array.isArray(modelArgs)) {
    return JSON.stringify({ status: "invalid_arguments", message: "Tool arguments must be a JSON object." });
  }
  // This function's own pins first; anything the model supplied (even a pinned key) is kept as given.
  const args = mergePinnedArguments(
    { tools: [binding.entry] },
    binding.entry.tool,
    modelArgs as Record<string, unknown>,
  );
  try {
    const result = await task.call(binding.entry.tool, args, {
      idempotencyKey: options?.idempotencyKey,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
    return JSON.stringify(modelResult(result));
  } catch (error) {
    if (error instanceof AuthorityApiError || error instanceof AuthorityTimeoutError) {
      return JSON.stringify(errorResult(error));
    }
    throw error;
  }
}

function errorResult(error: unknown): Record<string, unknown> {
  if (error instanceof AuthorityApiError) {
    return { status: "error", code: error.code, message: "Authority could not complete this request." };
  }
  if (error instanceof AuthorityTimeoutError) {
    return { status: "error", code: "TIMEOUT", message: "Authority did not answer in time." };
  }
  throw error;
}
