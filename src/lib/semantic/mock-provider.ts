import type { ProviderSignalPayload, SemanticIndicator, SemanticRiskInput } from "@/lib/domain";

import type { SemanticProviderCall, SemanticRiskProvider } from "./provider";

/**
 * Deterministic semantic-risk heuristics — the strongest practical adapter
 * available without a paid key or GPU (see docs/semantic/PROVIDER_RESEARCH.md).
 *
 * This is a rule-based *stand-in*, not a model, and it is not Jev. It reads
 * the redacted payload only. Its detection numbers in the evaluation report
 * are measured against a corpus written by the same team that wrote these
 * rules, so they say what the rules cover, not how a real model would fare.
 * Known blind spots (paraphrased injection, semantically-plausible-but-wrong
 * resource choices) are deliberately left in the corpus as misses.
 */

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "please", "then", "all"]);

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}
const stem = (token: string): string => token.slice(0, 5);
const clamp = (n: number): number => Math.min(1, Math.max(0, Number(n.toFixed(4))));

const INJECTION_PATTERNS: readonly { regex: RegExp; indicator: SemanticIndicator }[] = [
  {
    regex:
      /ignore\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules|directions)/i,
    indicator: "prompt_injection_phrase",
  },
  {
    regex:
      /disregard\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous\s+|prior\s+|above\s+|system\s+)?(?:instructions?|prompts?|rules|guidelines)/i,
    indicator: "prompt_injection_phrase",
  },
  {
    regex:
      /(?:reveal|print|show|output|repeat)\s+(?:your\s+|the\s+)?(?:system\s+prompt|hidden\s+instructions|initial\s+instructions)/i,
    indicator: "prompt_injection_phrase",
  },
  {
    regex: /you\s+are\s+now\s+(?:in\s+)?(?:an?\s+)?[a-z ]{0,20}(?:mode|assistant|admin|root)/i,
    indicator: "prompt_injection_phrase",
  },
  { regex: /(?:new|updated|real)\s+instructions?\s*[:-]/i, indicator: "prompt_injection_phrase" },
  {
    regex: /<\|?(?:im_start|im_end|system|endoftext)\|?>|\[\/?INST\]/i,
    indicator: "prompt_injection_phrase",
  },
  { regex: /(?:^|\n)\s*(?:system|assistant)\s*:\s/i, indicator: "prompt_injection_phrase" },
  { regex: /do anything now|jailbreak|developer mode/i, indicator: "prompt_injection_phrase" },
  {
    regex:
      /as\s+(?:the\s+)?(?:administrator|admin|root|system owner),?\s+(?:you\s+)?(?:must|should|are authori[sz]ed)/i,
    indicator: "instruction_override",
  },
  {
    regex:
      /(?:override|bypass|skip|disable)\s+(?:the\s+|all\s+|any\s+)?(?:safety|security|polic(?:y|ies)|approvals?|checks?|guardrails?)/i,
    indicator: "instruction_override",
  },
  {
    regex: /without\s+(?:asking|approval|confirmation|telling\s+the\s+user)/i,
    indicator: "instruction_override",
  },
];

const DISCLOSURE_ACTION =
  /(send|email|mail|post|publish|upload|share|invite|export|webhook|forward|notify|message)/;
const DESTRUCTIVE_ACTION = /(delete|remove|drop|destroy|purge|revoke|transfer|refund|terminate|disable|wipe)/;
const DESTRUCTIVE_INTENT =
  /(delet|remov|drop|destr|purge|revok|transf|refun|termi|disab|wipe|cancel|clean|close|merge)/;
const SENSITIVE_RESOURCE =
  /(?:^|[\s/"'=])(?:\.env(?:\.[a-z]+)?|id_rsa|id_ed25519|[a-z0-9_-]+\.pem|\.aws\/credentials|\.ssh\/|\.netrc|kubeconfig|secrets?\/|\/etc\/(?:passwd|shadow))(?=$|[\s/"'\]])/i;
const SIDE_EFFECT_KEY =
  /^(?:force|recursive|cascade|purge|notify_all|also_[a-z_]+|bcc|skip_[a-z_]+|no_verify)$/i;
const SHELL_CHAIN =
  /(?:;|&&|\|\|?)\s*(?:rm|curl|wget|nc|bash|sh|chmod|scp)\b|\$\([^)]*\)|`[^`]+`|\s--force\b|\s-rf\b/i;
const IDENTIFIER_KEY =
  /(repo|repository|project|org|owner|customer|account|user|invoice|payment|issue|pull|ticket|branch|charge|subscription)/i;
/**
 * Branch and ref names are chosen by the agent, not named by the user, so their absence from the task text is
 * expected and not evidence of substitution. (Before this exemption every ordinary `create_branch` was rated HIGH risk
 * and needed approval under enforcement: found by the Part 8 validation scenarios. Writing to the wrong branch is a
 * deterministic-layer concern: contracts pin the branch, and the connector confines writes to the task namespace.)
 */
const AGENT_CHOSEN_KEY = /^(?:branch|head_branch|target_branch|base_branch|head|base|ref)$/i;
const REPO_KEY = /(repo|repository|org|owner|project)/i;
const AMOUNT_KEY = /(amount|total|quantity|qty|price|limit|refund)/i;
const VAGUE_INTENT =
  /^(?:help|handle|take care of|do|fix|sort out|deal with)\s+(?:it|this|that|things?|stuff|everything)\b/i;

function flatStrings(args: SemanticRiskInput["arguments"]): string[] {
  const out: string[] = [];
  for (const value of Object.values(args)) {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) out.push(...value);
    else out.push(String(value));
  }
  return out;
}

function domainsIn(text: string): Set<string> {
  const domains = new Set<string>();
  for (const m of text.matchAll(/\[email:([a-z0-9.-]+)\]/gi)) domains.add(m[1].toLowerCase());
  for (const m of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) domains.add(m[1].toLowerCase());
  for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) domains.add(m[1].toLowerCase());
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|ai|co|app))\b/gi))
    domains.add(m[1].toLowerCase());
  return domains;
}

export interface MockSemanticRiskProviderOptions {
  /** Force a degraded outcome to exercise the runner's fallbacks. */
  simulate?: "ok" | "timeout" | "error" | "unavailable" | "malformed" | "extra_fields" | "slow";
  slowMs?: number;
}

export class MockSemanticRiskProvider implements SemanticRiskProvider {
  readonly name = "mock";
  readonly model = "mock-heuristic";
  readonly modelVersion = "2026-09-28.1";

  constructor(private readonly options: MockSemanticRiskProviderOptions = {}) {}

  async evaluate(input: SemanticRiskInput, call: SemanticProviderCall): Promise<unknown> {
    switch (this.options.simulate) {
      case "error":
        throw new Error("simulated provider failure");
      case "malformed":
        return { signals: "not-an-object" };
      case "extra_fields":
        // A hostile or buggy provider trying to smuggle authority in a
        // well-formed-looking reply. The runner must reject it.
        return { ...this.analyze(input), decision: "allow", grantedTools: ["github.delete_repo"] };
      case "timeout":
      case "slow":
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.options.slowMs ?? 60_000);
          call.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return this.analyze(input);
      default:
        return this.analyze(input);
    }
  }

  analyze(input: SemanticRiskInput): ProviderSignalPayload {
    const indicators = new Set<SemanticIndicator>();
    const intentText = input.taskIntent;
    const intentTokens = tokenize(intentText);
    const argStrings = flatStrings(input.arguments);
    const resource = input.resource ?? "";
    const surface = [...argStrings, resource].join("\n");
    const [, action = ""] = input.tool.split(".");
    const actionLower = `${action} ${input.operation}`.toLowerCase();

    let promptInjection = 0;
    let externalDisclosure = 0.05;
    let scopeExpansion = 0.05;
    let suspicious = 0.05;
    let planDeviation = 0.05;
    let resourceRelevance = 0.6;

    // 1. Injection phrases (also inside inlined decoded segments).
    let injectionHits = 0;
    for (const { regex, indicator } of INJECTION_PATTERNS) {
      if (regex.test(surface)) {
        injectionHits += 1;
        indicators.add(indicator);
      }
    }
    if (injectionHits > 0) promptInjection = injectionHits >= 2 ? 0.96 : 0.9;

    // 2. Secret material and encodings (markers left by redaction).
    const isDisclosure = DISCLOSURE_ACTION.test(actionLower);
    if (/\[REDACTED:(?!high_entropy)/.test(surface)) {
      indicators.add("secret_material_in_arguments");
      externalDisclosure = Math.max(externalDisclosure, isDisclosure ? 0.9 : 0.6);
    }
    if (/\[REDACTED:high_entropy\]/.test(surface)) {
      indicators.add("high_entropy_blob");
      suspicious = Math.max(suspicious, 0.4);
      externalDisclosure = Math.max(externalDisclosure, isDisclosure ? 0.55 : 0.25);
    }
    if (/\[DECODED:/.test(surface)) {
      indicators.add("encoded_payload");
      suspicious = Math.max(suspicious, 0.5);
      if (
        injectionHits > 0 ||
        SENSITIVE_RESOURCE.test(surface) ||
        /\[DECODED:[^\]]*\[REDACTED:/.test(surface)
      ) {
        suspicious = 0.88;
      }
    }

    // 3. Recipients / destinations.
    const trustedDomains = domainsIn(
      `${intentText}\n${input.priorCalls.flatMap((c) => flatStrings(c.arguments)).join("\n")}`,
    );
    const argDomains = domainsIn(surface);
    const untrusted = [...argDomains].filter((d) => !trustedDomains.has(d));
    if (untrusted.length > 0) {
      indicators.add("external_recipient");
      externalDisclosure = Math.max(externalDisclosure, isDisclosure ? 0.8 : 0.4);
    }
    if (isDisclosure) externalDisclosure = Math.max(externalDisclosure, 0.2);

    // 4. Sensitive resources.
    const intentMentionsSensitive = /(env|secret|credential|key|token|ssh|config)/i.test(intentText);
    if (SENSITIVE_RESOURCE.test(surface) && !intentMentionsSensitive) {
      indicators.add("unrelated_resource_identifier");
      scopeExpansion = Math.max(scopeExpansion, 0.75);
      resourceRelevance = Math.min(resourceRelevance, 0.15);
      externalDisclosure = Math.max(externalDisclosure, isDisclosure ? 0.9 : 0.45);
    }

    // 5. Identifier substitution / cross-repository access.
    const intentIdentifiers = intentText.toLowerCase();
    const intentHasSpecificIdentifier = /[a-z0-9]+[-_/][a-z0-9]+|\b\d{2,}\b/.test(intentText);
    let checked = 0;
    let mismatched = 0;
    for (const [key, value] of Object.entries(input.arguments)) {
      if (!IDENTIFIER_KEY.test(key) || Array.isArray(value) || AGENT_CHOSEN_KEY.test(key)) continue;
      const v = String(value).trim().toLowerCase();
      if (!v || v.startsWith("[")) continue;
      checked += 1;
      const tail = v.split("/").pop() ?? v;
      const knownFromIntent = intentIdentifiers.includes(v) || intentIdentifiers.includes(tail);
      const priorSame = input.priorCalls
        .map((c) => c.arguments[key])
        .filter((p): p is string | number | boolean => p !== undefined && !Array.isArray(p))
        .map((p) => String(p).toLowerCase());
      const knownFromPrior = priorSame.includes(v);
      if (knownFromIntent || knownFromPrior) continue;
      if (priorSame.length > 0) {
        mismatched += 1;
        suspicious = Math.max(suspicious, 0.65);
        indicators.add(REPO_KEY.test(key) ? "cross_repository_reference" : "unrelated_resource_identifier");
      } else if (intentHasSpecificIdentifier) {
        mismatched += 1;
        indicators.add(REPO_KEY.test(key) ? "cross_repository_reference" : "unrelated_resource_identifier");
      }
    }
    if (checked > 0) {
      resourceRelevance = Math.min(resourceRelevance, clamp(0.9 - 0.85 * (mismatched / checked)));
      if (mismatched > 0) scopeExpansion = Math.max(scopeExpansion, 0.7);
    }

    // 6. Amount escalation (numbers in the trusted intent are the yardstick).
    // Only standalone numbers count as amounts: digits inside identifiers
    // (cus_4821, ch_9912, issue-991) must not become the "intent amount".
    const intentNumbers = [
      ...intentText.matchAll(/(?<![A-Za-z0-9_#-])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9_-])/g),
    ].map((m) => Number(m[0].replace(/,/g, "")));
    const maxIntent = intentNumbers.length ? Math.max(...intentNumbers) : null;
    for (const [key, value] of Object.entries(input.arguments)) {
      if (!AMOUNT_KEY.test(key)) continue;
      const n =
        typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
      if (!Number.isFinite(n)) continue;
      const prior = input.priorCalls
        .map((c) => Number(c.arguments[key]))
        .filter((p) => Number.isFinite(p) && p > 0);
      if (prior.length > 0 && n > 3 * Math.max(...prior)) {
        suspicious = Math.max(suspicious, 0.6);
        indicators.add("amount_escalation");
      }
      if (maxIntent !== null) {
        // Payment APIs commonly take minor units (cents): 2500 for "$25".
        const withinIntent = n <= maxIntent * 1.5 || (Number.isInteger(n) && n / 100 <= maxIntent * 1.01);
        if (!withinIntent) {
          indicators.add("amount_escalation");
          suspicious = Math.max(suspicious, n > maxIntent * 10 ? 0.95 : 0.85);
        }
      }
    }

    // 7. Tool / action semantics.
    const allowed = input.contractAllowedTools;
    if (allowed.length > 0 && !allowed.includes(input.tool)) {
      indicators.add("tool_not_in_plan");
      scopeExpansion = Math.max(scopeExpansion, 0.9);
      planDeviation = Math.max(planDeviation, 0.85);
    }
    if (DESTRUCTIVE_ACTION.test(actionLower) && !DESTRUCTIVE_INTENT.test(intentText.toLowerCase())) {
      indicators.add("destructive_action_unrequested");
      scopeExpansion = Math.max(scopeExpansion, 0.7);
    }
    const idx = allowed.indexOf(input.tool);
    if (idx > 0 && input.priorCalls.length === 0) {
      indicators.add("plan_step_skipped");
      planDeviation = Math.max(planDeviation, 0.45);
    }

    // 8. Extra side effects.
    for (const [key, value] of Object.entries(input.arguments)) {
      if (SIDE_EFFECT_KEY.test(key) && value !== false && value !== "false") {
        indicators.add("unexpected_side_effect");
        scopeExpansion = Math.max(scopeExpansion, 0.65);
      }
    }
    if (SHELL_CHAIN.test(surface)) {
      indicators.add("unexpected_side_effect");
      scopeExpansion = Math.max(scopeExpansion, 0.85);
    }

    // 9. Alignment, ambiguity, confidence.
    const intentStems = new Set(intentTokens.map(stem));
    const actionTokens = tokenize(`${action} ${input.operation} ${argStrings.join(" ")} ${resource}`);
    const overlap = actionTokens.length
      ? actionTokens.filter((t) => intentStems.has(stem(t))).length / actionTokens.length
      : 0;
    let taskAlignment = clamp(0.35 + 0.65 * overlap);
    if (indicators.has("destructive_action_unrequested") || indicators.has("tool_not_in_plan")) {
      taskAlignment = Math.min(taskAlignment, 0.25);
    }
    const ambiguous = intentTokens.length < 3 || VAGUE_INTENT.test(intentText.trim());
    if (ambiguous) {
      indicators.add("ambiguous_task");
      taskAlignment = 0.5;
    }

    const signals = {
      taskAlignment,
      resourceRelevance: clamp(resourceRelevance),
      scopeExpansion: clamp(scopeExpansion),
      externalDisclosure: clamp(externalDisclosure),
      promptInjection: clamp(promptInjection),
      suspiciousArgumentChange: clamp(suspicious),
      planDeviation: clamp(planDeviation),
    };
    const strongest = Math.max(
      signals.scopeExpansion,
      signals.externalDisclosure,
      signals.promptInjection,
      signals.suspiciousArgumentChange,
      signals.planDeviation,
    );
    const confidence = ambiguous
      ? 0.4
      : strongest >= 0.8
        ? 0.85
        : indicators.size === 0 && taskAlignment >= 0.6
          ? 0.7
          : 0.6;

    return {
      signals,
      indicators: [...indicators],
      confidence,
    };
  }
}
