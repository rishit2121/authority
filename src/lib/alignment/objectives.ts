import { OBJECTIVES_SYSTEM } from "./prompts";
import type { AlignmentReviewer, ReviewerFailure, ReviewerUsage } from "./reviewer";
import { objectivesJsonSchema, objectivesSchema } from "./schemas";
import { extractTaskInstructions } from "./task-shield";
import type { AlignmentPolicy, TaskObjectives } from "./types";

/**
 * Establishing the trusted task set from the task's authenticated request.
 *
 * Reference policy: Task Shield's own extraction (Figure 4) applied to the user
 * message, giving T_u.
 * Production policy: one structured extraction that yields T_u by the same
 * rules plus prohibitions, required values and quoted material (kept apart
 * from instructions). Either way the original request text is stored next to
 * the extraction and passed to every later review, so a restriction the
 * extractor missed is not lost.
 */

export interface StoredExtraction {
  schemaVersion: 1;
  taskInstructions: string[];
  prohibitions: string[];
  requirements: { kind: string; value: string; text: string }[];
  quotedMaterial: string[];
}

export function objectivesFromStored(
  version: number,
  requestText: string,
  stored: unknown,
): TaskObjectives | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<StoredExtraction>;
  if (!Array.isArray(s.taskInstructions) || s.taskInstructions.length === 0) return null;
  return {
    version,
    requestText,
    taskInstructions: s.taskInstructions.map(String),
    prohibitions: Array.isArray(s.prohibitions) ? s.prohibitions.map(String) : [],
    requirements: Array.isArray(s.requirements) ? s.requirements : [],
    quotedMaterial: Array.isArray(s.quotedMaterial) ? s.quotedMaterial.map(String) : [],
  };
}

export type Extracted =
  | { ok: true; extraction: StoredExtraction; usage: ReviewerUsage }
  | { ok: false; reason: ReviewerFailure; usage: ReviewerUsage };

export async function extractObjectives(
  reviewer: AlignmentReviewer,
  requestText: string,
  policy: AlignmentPolicy,
): Promise<Extracted> {
  if (policy === "reference") {
    const r = await extractTaskInstructions(reviewer, "the user", requestText);
    if (!r.ok) return r;
    if (r.value.length === 0) return { ok: false, reason: "malformed", usage: r.usage };
    return {
      ok: true,
      extraction: {
        schemaVersion: 1,
        taskInstructions: r.value,
        prohibitions: [],
        requirements: [],
        quotedMaterial: [],
      },
      usage: r.usage,
    };
  }
  const r = await reviewer.call({
    name: "task_objectives",
    system: OBJECTIVES_SYSTEM,
    user: `User request:\n${requestText}`,
    jsonSchema: objectivesJsonSchema,
    parse: objectivesSchema,
  });
  if (!r.ok) return r;
  return {
    ok: true,
    extraction: {
      schemaVersion: 1,
      taskInstructions: r.data.task_instructions,
      prohibitions: r.data.prohibitions,
      requirements: r.data.requirements,
      quotedMaterial: r.data.quoted_material,
    },
    usage: r.usage,
  };
}
