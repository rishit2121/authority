import { REST_CONNECTOR_SPECS } from "./providers";

const REST_BY_ID = new Map(REST_CONNECTOR_SPECS.map((spec) => [spec.id, spec]));

function mentions(intent: string, words: string[]): boolean {
  const text = ` ${intent.toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
  return words.some((w) => w.length > 1 && text.includes(` ${w} `));
}

/**
 * Which tools AI plan generation is offered. With 100+ API-key connectors, handing the model every operation would
 * bloat each prompt with services the request never mentions, so a declarative REST connector's tools are offered
 * only when the request names that service ("open a Jira issue", "reply in Front"). Hand-written connectors and
 * tenant-published operations are always offered. Explicit plans (the SDK's prepareTask) can use any connector.
 */
export function offeredToAiPlanner(provider: string, intent: string): boolean {
  const spec = REST_BY_ID.get(provider);
  if (!spec) return true;
  const name = spec.name.toLowerCase();
  const variants = [
    spec.id,
    spec.id.replace(/_/g, " "),
    name,
    name.replace(/[^a-z0-9]+/g, " ").trim(),
    name.split(/[\s.]/)[0]!,
  ];
  return mentions(intent, [...new Set(variants)]);
}
