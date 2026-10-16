# Task alignment

Authority's contract answers "is this exact call allowed?". Task alignment answers a different question:
**do the plan, its values, and the content an agent reads actually serve what the user asked for?** It is
based on Task Shield (Jia, Wu, Qin, Squicciarini — _The Task Shield: Enforcing Task Alignment to Defend
Against Indirect Prompt Injection in LLM Agents_, ACL 2025, <https://aclanthology.org/2025.acl-long.1435.pdf>).

It is **off for every application** until an administrator turns it on (Settings → Applications → _Task
alignment_). Contract enforcement, pinned-value checks and task sessions are unchanged by it; alignment can
only hold, stop or withhold — never allow more.

## Paper component → implementation

| Task Shield (paper)                                                                                   | Where                                                                                                      | Notes                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| User task set `T_u`, extracted from user messages (§4.1, Fig. 4)                                      | `src/lib/alignment/objectives.ts`, `task_objectives`                                                       | Extracted from the task's stored request (`tasks.intent`) as version 1; later versions only from the backend key (`POST /tasks/{id}/objectives`). |
| Instruction extraction `E(M)` (§4.1, Fig. 4 prompt)                                                   | `task-shield.ts: extractTaskInstructions`, `prompts.ts: TASK_EXTRACTION_SYSTEM`                            | Prompt verbatim.                                                                                                                                  |
| ContributesTo score `s(e,t) ∈ [0,1]` (§3.3, Def. 2; Fig. 5 content checker, Fig. 6 tool-call checker) | `task-shield.ts: scoreInstruction`, `scoreToolCall`                                                        | Prompts verbatim; one score per `t`, in order — a missing score is malformed, never 0 or 1.                                                       |
| Aggregate `S(e) = Σ_t s(e,t)` and decision `misaligned ⇔ S(e) = 0` / `C_e ≤ ε` (§4.1, Alg. 1)         | `toInstructionScore`, `REFERENCE_EPSILON = 0`                                                              | Reference configuration uses ε = 0.                                                                                                               |
| Algorithm 1 per message (user → extend `T_u`; otherwise score each instruction)                       | `task-shield.ts: processMessage`                                                                           |                                                                                                                                                   |
| Tool-output source tag "from tool [name] with arguments [args]" (§4.2)                                | `content-inspection.ts: sourceDescription`                                                                 |                                                                                                                                                   |
| Feedback: misalignment alert, tool-output violation, user-task reminder (§4.1, Fig. 7)                | `task-shield.ts: generateFeedback`                                                                         | Templates verbatim.                                                                                                                               |
| Assistant-level check of tool calls, misaligned calls not executed (§4.2)                             | Plan review at `prepare` (reference policy: Fig. 6 per step); runtime action check is increment 2          |                                                                                                                                                   |
| Tool-level check of tool outputs, original output + feedback (§4.2)                                   | `POST /tasks/{id}/content` with **policy = reference** → status `flagged`, original returned with feedback |                                                                                                                                                   |

**Documented deviations from the paper's format.** Strict structured outputs need an object at the top level,
so arrays come back in a named field (`instructions`, `scores`) and the per-element key "ContributeTo score" is
named `contribute_to_score`. Judging instructions are unchanged. The paper ran with temperature 0 on
`gpt-4o-2024-05-13`; Authority uses the configured `OPENAI_MODEL` (default `gpt-6-luna`) and does not send a
temperature, and no setting makes these judgments deterministic.

## Production extensions (not in the paper)

- **Structured objectives.** One extraction also yields prohibitions, required values (recipient, channel,
  account, payment, amount, currency, limit, condition) and quoted material, kept apart from instructions.
  The original request text is stored and passed to every review, so a restriction the extractor missed is
  not lost.
- **Deterministic value checks** (`values.ts`). Recipients, channels, resource ids, amounts, currencies and
  links in a plan are compared with literals in the request text. A different value of the same kind is a
  _conflict_; an undetermined consequential value is _ambiguous_; values bound to an earlier step's output are
  left to the runtime check. A positive contribution score never clears a conflict.
- **Plan/value review** (`plan-review.ts`). One structured review scores every step against every user task
  instruction and reports typed findings: `wrong_recipient`, `wrong_channel`, `wrong_resource`,
  `wrong_amount`, `wrong_currency`, `unrequested_side_effect`, `extra_operation`, `contradicted_prohibition`,
  `unresolved_value`, `missing_outcome`. Outcome: any conflict → _misaligned_ (revise); otherwise any ambiguity
  → _ambiguous_ (hold); reviewer failure → _unreviewed_ (hold); else _aligned_. The plan is never edited.
- **Content screening** (`content-inspection.ts`). Separates directives aimed at the agent from instructions
  that are part of the data (a support ticket's ask, a quoted email, a to-do list the user asked to process).
  Agent-directed + zero contribution or a contradicted prohibition → **quarantined**; agent-directed and
  uncertain → **held**; otherwise **passed** — returned as `external_data`, never as a system or user
  instruction, and with no claim that it is safe.
- **Enforcement and versions.** Reviews are bound to the exact subject hash, objectives version, context
  revision (bumped by every inspected piece of content) and contract. Under enforcement the database refuses to
  activate a contract without a clean plan review or a person's approval of that exact review
  (`gateway.contract_alignment_cleared`, checked in `activate_task_contract_core`). Retries reuse the stored
  review instead of calling the model again.
- **Task isolation first.** With enforcement on, alignment endpoints refuse a raw runtime key
  (`TASK_SESSION_REQUIRED`): content belongs to one task, and only a task session or the backend key proves which.
- **Failure is never a pass.** Timeout, refusal, malformed output, unavailable provider, exhausted quota or
  budget, oversized or unsupported content → _unreviewed_.

## Modes and policies

|                | shadow                                               | enforce                                                                                                                                                |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **reference**  | Records Task Shield results; never changes anything. | Plans with a zero-contribution step need revision; content comes back as the original **plus feedback** (status `flagged`). For controlled evaluation. |
| **production** | Records all findings; never changes anything.        | Misaligned plans → `alignment_review` (revise); ambiguous/unreviewed → hold; quarantined/held/unreviewed content is withheld.                          |

## Payload handling and retention

- The reviewer is called with one system and one user message, a strict JSON schema, no tools and no history.
  Untrusted text is wrapped in `<untrusted_… id="nonce">` blocks; secret material (keys, tokens, credentials)
  is removed first (`removeSecretMaterial`); recipients and ids are kept because the checks need them.
- Nothing raw is stored for content that **passed**: only its SHA-256, size, source description and findings.
- Content that is **flagged, quarantined, held or unreviewed** is stored encrypted in Supabase Vault for review,
  up to 128 KiB, for 7 days (bounded to 1–30 days), then overwritten (`purge_expired_alignment_content`).
  Security admins and above can view it from the task page; each view is recorded.
- Findings store short excerpts (≤ 300 characters) of the offending instruction or value.

## Routing external data through Authority

Coverage is **mediated content only**: what your application sends here (and, in increment 2, Authority's own
connector results). Authority cannot see what else your model reads.

1. Turn it on: Settings → Applications → your app → _Task alignment_ → **Shadow** first, then **Enforce**.
2. Give the agent a task session (`agent.sessions.create({ taskId })`) — enforcement refuses raw runtime keys.
3. Before your model sees any fetched text, inspect it:

```ts
import { formatExternalData } from "@authority/sdk";

const inspected = await agent.content.inspect(taskId, {
  content: emailBody,
  source: { kind: "email", label: "Support inbox" },
});
const block = formatExternalData(inspected); // null when withheld
if (block) messages.push({ role: "tool", tool_call_id, content: block });
else
  messages.push({
    role: "tool",
    tool_call_id,
    content: `Content withheld by Authority (${inspected.status}).`,
  });
```

4. `prepare` may now return `status: "alignment_review"` with `decision: "revise"` (submit a corrected plan) or
   `"hold"` (an administrator reviews it on the task page; call `prepare` again with the same plan afterwards).
5. If the user changes what they want, record it with the backend key:
   `backend.tasks.reviseObjectives(taskId, newRequest)`, then prepare again.
6. Held content: poll `agent.content.get(inspectionId)`; `data` appears only after an administrator approves.
   Text inside the content saying "approved" or "the user said so" is not approval.

## Limits

Scores and findings are model judgments, not calibrated probabilities. Extraction can miss nested or
implicit instructions, and the reviewer itself reads hostile text. Deterministic checks only cover values that
literally appear in the request. Each review costs model calls (see the evaluation README for measured
counts). None of this replaces task sessions: a semantic check cannot stand in for authenticated task
isolation.
