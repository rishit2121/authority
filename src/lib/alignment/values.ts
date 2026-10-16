import type { AlignmentFinding } from "./types";
import { clip } from "./types";

/**
 * Deterministic value checks (a production extension; not part of Task
 * Shield). The user's request text is the only authoritative source of
 * concrete values, so recipients, channels, resource ids, amounts and
 * currencies in a plan or tool call are compared with literals that actually
 * occur in that text. No model is involved, and a finding here cannot be
 * outweighed by a high contribution score.
 *
 *  - A value that contradicts a literal of the same kind in the request is a
 *    "conflict" (e.g. the request names alice@acme.test, the plan emails
 *    eve@evil.test; the request says $5, the plan refunds 50000 cents).
 *  - A consequential value the request does not determine at all is
 *    "unresolved" (ambiguous), unless it is bound to an earlier step's output
 *    through a data-flow reference -- those are judged when the call happens.
 *
 * Free text (subject, body, message) is never compared here: wording may
 * legitimately differ. Semantic review covers it.
 */

export interface RequestLiterals {
  emails: Set<string>;
  hosts: Set<string>;
  /** Amounts in minor units (cents), with the currency when one was written. */
  amounts: { minor: number; currency: string | null }[];
  currencies: Set<string>;
  /** Lowercased request text, for "does this id/channel appear verbatim" checks. */
  text: string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s"'<>)]+/gi;
const CURRENCY_WORDS: Record<string, string> = {
  $: "usd",
  usd: "usd",
  dollar: "usd",
  dollars: "usd",
  "€": "eur",
  eur: "eur",
  euro: "eur",
  euros: "eur",
  "£": "gbp",
  gbp: "gbp",
  pound: "gbp",
  pounds: "gbp",
};
const MONEY_BEFORE = /(\$|€|£|\b(?:usd|eur|gbp))\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/gi;
const MONEY_AFTER =
  /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(usd|eur|gbp|dollars?|euros?|pounds?|cents?)\b/gi;

function minorUnits(whole: string, fraction: string | undefined): number {
  const base = Number(whole.replace(/,/g, "")) * 100;
  if (!fraction) return base;
  return base + Number(fraction.padEnd(2, "0"));
}

export function extractRequestLiterals(requestText: string): RequestLiterals {
  const emails = new Set((requestText.match(EMAIL) ?? []).map((e) => e.toLowerCase()));
  const hosts = new Set<string>();
  for (const url of requestText.match(URL_RE) ?? []) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase());
    } catch {
      /* not a URL */
    }
  }
  const amounts: RequestLiterals["amounts"] = [];
  const currencies = new Set<string>();
  for (const m of requestText.matchAll(MONEY_BEFORE)) {
    const currency = CURRENCY_WORDS[m[1].toLowerCase()] ?? null;
    if (currency) currencies.add(currency);
    amounts.push({ minor: minorUnits(m[2], m[3]), currency });
  }
  for (const m of requestText.matchAll(MONEY_AFTER)) {
    const unit = m[3].toLowerCase();
    if (unit.startsWith("cent")) {
      amounts.push({ minor: Number(m[1].replace(/,/g, "")), currency: null });
      continue;
    }
    const currency = CURRENCY_WORDS[unit] ?? null;
    if (currency) currencies.add(currency);
    amounts.push({ minor: minorUnits(m[1], m[2]), currency });
  }
  return { emails, hosts, amounts, currencies, text: requestText.toLowerCase() };
}

type FieldClass = "recipient" | "channel" | "resource" | "amount" | "currency" | "url" | null;

const RECIPIENT_KEYS = /^(to|cc|bcc|recipients?|email|emails|recipient_email|reply_to)$/i;
const CHANNEL_KEYS = /^(channel|channel_id|channel_name|conversation)$/i;
const AMOUNT_KEYS = /^(amount|amount_cents|amount_minor|value_cents|total|price|refund_amount)$/i;
const CURRENCY_KEYS = /^currency$/i;
const URL_KEYS = /^(url|link|webhook|webhook_url|callback_url)$/i;
const RESOURCE_KEYS =
  /(_id|_ids)$|^(customer|account|payment|charge|invoice|repository|repo|issue|page|database|file|path|order|user)$/i;

export function classifyField(key: string, identifiesResource: boolean): FieldClass {
  if (RECIPIENT_KEYS.test(key)) return "recipient";
  if (CHANNEL_KEYS.test(key)) return "channel";
  if (AMOUNT_KEYS.test(key)) return "amount";
  if (CURRENCY_KEYS.test(key)) return "currency";
  if (URL_KEYS.test(key)) return "url";
  if (identifiesResource || RESOURCE_KEYS.test(key)) return "resource";
  return null;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return [];
}

function requestHasChannel(lit: RequestLiterals): boolean {
  // "#general", a Slack-style id ("c-bob-team", "c0123abcd"), or the word "channel" next to a name.
  return /(^|\s)#[\w-]{2,}/.test(lit.text) || /\bc[-0-9][a-z0-9-]{3,}\b/.test(lit.text);
}

/** Same id family: `pi_` payment ids, `cus_` customers, `C-` / `C0` channels, ... */
function prefixOf(value: string): string | null {
  const m = /^([a-z]{1,6}[_-])/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

export interface CheckableCall {
  stepId?: string;
  tool: string;
  args: Record<string, unknown>;
  /** Argument keys whose value comes from an earlier step's output (data-flow refs). */
  derivedKeys?: ReadonlySet<string>;
  /** Registry metadata: which argument keys identify the resource. */
  resourceKeys?: ReadonlySet<string>;
}

export function checkCallValues(call: CheckableCall, lit: RequestLiterals): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const add = (f: Omit<AlignmentFinding, "source" | "stepId">) =>
    findings.push({ ...f, source: "deterministic", ...(call.stepId ? { stepId: call.stepId } : {}) });

  for (const [key, raw] of Object.entries(call.args)) {
    if (call.derivedKeys?.has(key)) continue;
    const cls = classifyField(key, call.resourceKeys?.has(key) ?? false);
    if (!cls) continue;
    const values = stringValues(raw)
      .map((v) => v.trim())
      .filter(Boolean);

    for (const value of values) {
      const lower = value.toLowerCase();
      if (cls === "recipient") {
        const emails = lower.match(EMAIL) ?? [lower];
        for (const email of emails) {
          if (lit.emails.has(email)) continue;
          add(
            lit.emails.size > 0
              ? {
                  type: "wrong_recipient",
                  severity: "conflict",
                  field: key,
                  value: clip(email, 200),
                  explanation: `${email} is not a recipient named in the request (${[...lit.emails].join(", ")}).`,
                }
              : {
                  type: "unresolved_value",
                  severity: "ambiguous",
                  field: key,
                  value: clip(email, 200),
                  explanation: `The request does not say who should receive this; ${email} was chosen by the plan.`,
                },
          );
        }
      } else if (cls === "channel") {
        const bare = lower.replace(/^#/, "");
        if (lit.text.includes(bare)) continue;
        add(
          requestHasChannel(lit)
            ? {
                type: "wrong_channel",
                severity: "conflict",
                field: key,
                value: clip(value, 200),
                explanation: `${value} is not the channel named in the request.`,
              }
            : {
                type: "unresolved_value",
                severity: "ambiguous",
                field: key,
                value: clip(value, 200),
                explanation: `The request does not name a channel; ${value} was chosen by the plan.`,
              },
        );
      } else if (cls === "resource") {
        if (lower.length < 3 || lit.text.includes(lower)) continue;
        const prefix = prefixOf(lower);
        const sameFamily = prefix !== null && lit.text.includes(prefix);
        add(
          sameFamily
            ? {
                type: "wrong_resource",
                severity: "conflict",
                field: key,
                value: clip(value, 200),
                explanation: `${value} differs from the ${prefix}… identifier in the request.`,
              }
            : {
                type: "unresolved_value",
                severity: "ambiguous",
                field: key,
                value: clip(value, 200),
                explanation: `The request does not identify this ${key}; ${value} was chosen by the plan.`,
              },
        );
      } else if (cls === "url") {
        let host: string | null = null;
        try {
          host = new URL(value).hostname.toLowerCase();
        } catch {
          host = null;
        }
        if (host && lit.hosts.has(host)) continue;
        add({
          type: "unresolved_value",
          severity: lit.hosts.size > 0 ? "conflict" : "ambiguous",
          field: key,
          value: clip(value, 200),
          explanation: `The request does not mention ${host ?? value}.`,
        });
      } else if (cls === "currency") {
        if (lit.currencies.size === 0 || lit.currencies.has(lower)) continue;
        add({
          type: "wrong_currency",
          severity: "conflict",
          field: key,
          value: clip(value, 50),
          explanation: `The request is in ${[...lit.currencies].join("/")}, the plan uses ${value}.`,
        });
      } else if (cls === "amount") {
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        // An amount field is either minor units (amount_cents) or major units; accept either reading that matches.
        const candidates = /cents|minor/i.test(key) ? [n] : [n, Math.round(n * 100)];
        if (lit.amounts.length === 0) {
          add({
            type: "unresolved_value",
            severity: "ambiguous",
            field: key,
            value,
            explanation: `The request does not state an amount; ${value} was chosen by the plan.`,
          });
        } else if (!lit.amounts.some((a) => candidates.includes(a.minor))) {
          const stated = lit.amounts
            .map((a) => `${(a.minor / 100).toFixed(2)}${a.currency ? ` ${a.currency.toUpperCase()}` : ""}`)
            .join(", ");
          add({
            type: "wrong_amount",
            severity: "conflict",
            field: key,
            value,
            explanation: `The request states ${stated}; the plan uses ${value}${/cents|minor/i.test(key) ? " (minor units)" : ""}.`,
          });
        }
      }
    }
  }
  return findings;
}
