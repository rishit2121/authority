# Semantic provider research

Researched 2026-09-28 from official pages where reachable. Third-party claims are marked. Anything not confirmed from
an official source is **UNVERIFIED**. This is a snapshot: re-check before relying on any figure.

## Jev

- **What it is:** TypeSafe AI's "System One" decision model. Input is a text/JSON `state` plus typed questions
  (Choice, Score, Noul = 0–1 yes/no probability); output is typed answers with probabilities and a confidence. It does
  not generate text. Docs: <https://docs.typesafe.ai/>, <https://docs.typesafe.ai/models>,
  <https://openrouter.ai/docs/guides/community/jev>.
- **Access:** hosted only. Direct: `POST /v1/systemone`, models `jev-1.13.0` / `jev-latest` / `jev-preview`. Via
  OpenRouter: `POST https://openrouter.ai/api/alpha/decisions`, model `typesafe/jev-1.13` (docs label this surface
  "alpha"; it is not chat-completions).
- **Cost/limits (official docs):** $0.042 per million input tokens, output free; 32k context for state plus longest
  question; 1,200 requests/min. A paid OpenRouter or TypeSafe key is required; the TypeSafe console is "early access".
  No free tier found.
- **Latency:** the vendor homepage claims 0.114 s "based on workflows for System One tasks" (conditions not stated
  beyond that). The "70–500 ms" figure appears only on third-party pages — UNVERIFIED. No latency figure in the docs.
- **Weights / fine-tuning / license:** no open weights, self-hosting or per-account fine-tuning found in official
  docs (a third-party source says proprietary/shared weights — UNVERIFIED). Commercial terms sit in TypeSafe's Master
  Customer Agreement, which could not be read — UNVERIFIED. Official statements: not trained on customer data;
  zero-data-retention available to enterprise customers.
- **Accuracy:** one third-party project reports ~68% — UNVERIFIED.
- **Community integrations** (ActionGate, jev-guard) gate tool calls with Jev; ActionGate's own README says its direct
  TypeSafe adapter is not live-verified and has had no external security review.

**Verdict:** real, named and shaped like our problem, but hosted-only, needs a paid key, alpha API surface, unverified
commercial terms and latency conditions. **Not integrated.** No code here claims to call Jev.

## "Laya / Luma"

"Laya" exists (Convai Innovations, Apache-2.0, ModernBERT-based 421M English / 322M multilingual, same
Choice/Score/Noul format): <https://huggingface.co/convaiinnovations/laya>. "Luma" did not match anything. The card
claims 39.5 ms single-question latency **on a T4 GPU**; the "7.8× faster than Jev" comparison mixes a local GPU with a
network API. A third-party test measured ~49 s/prediction on a CPU-only VPS and poor zero-shot accuracy — UNVERIFIED.
512-token context is short for agent traces; fine-tuning is needed. **Not practical without GPU infrastructure.**

## Other candidates

| Candidate                                | License                 | Hosting                     | Fit                                                                 |
| ---------------------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------------- |
| Llama Prompt Guard 2 (22M/86M)           | Llama community (gated) | self-hosted                 | injection/jailbreak text classifier only; no task-alignment signals |
| Llama Guard 4 (12B)                      | Llama community         | self-hosted, GPU            | content-safety categories, not tool-call risk                       |
| ProtectAI deberta-v3 prompt-injection v2 | Apache-2.0              | self-hosted (ONNX possible) | binary injection only; project archived                             |
| Qualifire prompt-injection-sentinel      | custom, gated           | self-hosted                 | binary injection; license needs review                              |
| IBM Granite Guardian 3.3 8B              | Apache-2.0              | self-hosted (vLLM), GPU     | yes/no risk checks incl. function-calling hallucination             |
| NVIDIA Nemotron Safety Guard 8B          | NVIDIA + Llama license  | self-hosted, H100/A100      | harm categories, not injection/tool risk                            |
| ShieldGemma 2B                           | Gemma terms             | self-hosted                 | four harm policies; wrong scope                                     |
| Lakera Guard                             | commercial SaaS         | hosted (`/v2/guard`)        | injection/PII screening; key + pricing undisclosed                  |

None emit the full signal set we want (alignment, scope, plan deviation, disclosure, injection) in one call.

## Decision

1. **Ship now:** a provider-neutral `SemanticRiskProvider` port (`src/lib/semantic/provider.ts`) with
   - `mock` — a deterministic rule-based heuristic (`MockSemanticRiskProvider`). Not a model and not Jev.
   - `legacy_lexical` — the original Part 1 lexical-overlap provider adapted onto the port (also the disagreement
     baseline in the evaluation).
   - `openai_compatible` — a hosted chat model with a JSON-schema reply covering every signal. It is the only route that
     yields all signals in one call without GPUs. Needs `SEMANTIC_PROVIDER_API_KEY` (optionally
     `SEMANTIC_PROVIDER_BASE_URL`, https only). **Implemented and unit-tested against a mocked `fetch`; never exercised
     against a live endpoint in this repository** because no key was available.
2. **Future Jev adapter** (if a key and acceptable terms are obtained): implement `SemanticRiskProvider.evaluate`
   by sending the redacted input as Jev `state` with one Noul/Score question per signal (task alignment, resource
   match, scope expansion, external disclosure, injection, suspicious change, plan deviation) and mapping the
   probabilities onto `semanticSignalsSchema`. Nothing downstream changes: the runner validates the mapped payload
   with the same strict schema as any other provider.
3. **Later, CPU-side injection signal:** Prompt Guard 2 or the ProtectAI model via ONNX could feed
   `promptInjection` only.
