/** Deterministic placeholder resolution. Scenarios stay reproducible: every value derives from the task id and seed. */

export interface TemplateContext {
  task8: string;
  tag: string;
  branch: string;
  branch2: string;
}

export function templateContext(taskId: string, seed: number): TemplateContext {
  const task8 = taskId.replace(/-/g, "").slice(0, 8);
  const tag = (Math.abs(seed) % 2_176_782_336).toString(36).padStart(4, "0");
  return { task8, tag, branch: `authority/${task8}/fix-${tag}`, branch2: `authority/${task8}/extra-${tag}` };
}

export function resolveTemplates<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === "string") {
    return value
      .replaceAll("{{task8}}", ctx.task8)
      .replaceAll("{{tag}}", ctx.tag)
      .replaceAll("{{branch}}", ctx.branch)
      .replaceAll("{{branch2}}", ctx.branch2) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveTemplates(v, ctx)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveTemplates(v, ctx)]),
    ) as unknown as T;
  }
  return value;
}

/** Small, fast, seedable PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
