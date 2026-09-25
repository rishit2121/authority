import "server-only";

import type { Permission } from "./types";

/**
 * Mechanical permission hierarchy, reconstructed purely from operation sets.
 *
 * Relationships are derived structurally — never from a permission's name or
 * any inferred meaning. Two permissions relate in exactly one of four ways:
 *
 *  - `narrower`: this permission's operations are a *strict* subset of the
 *    other's.
 *  - `broader`: the inverse.
 *  - `equivalent`: identical operation sets (distinct from narrower/broader —
 *    a strict-subset relation is irreflexive, so equal sets are neither
 *    narrower nor broader than each other).
 *  - unrelated: neither set contains the other (including disjoint sets) —
 *    represented by the *absence* of an edge, not a value.
 *
 * A strict-subset relation over sets is a partial order: antisymmetric and
 * transitive by construction. A genuine cycle (A narrower than B narrower
 * than A) is therefore mathematically impossible for correctly computed
 * edges — the only way one could appear is a bug in this function itself,
 * which `assertNoCycles` guards defensively and a unit test exercises,
 * satisfying "cycles fail validation" even though the property is provable
 * rather than merely observed.
 */

export interface HierarchyEdge {
  narrowerId: string;
  broaderId: string;
}

export interface PermissionHierarchy {
  /** Every strict narrower/broader edge, deterministically ordered. */
  edges: HierarchyEdge[];
  /** Permission ID -> set of permission IDs with identical operation coverage (never includes itself). */
  equivalentGroups: Map<string, string[]>;
}

function isStrictSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size >= b.size) return false;
  for (const op of a) if (!b.has(op)) return false;
  return true;
}

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const op of a) if (!b.has(op)) return false;
  return true;
}

/** Deterministic ordering used whenever permissions are compared or displayed. */
export function comparePermissionIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildPermissionHierarchy(permissions: readonly Permission[]): PermissionHierarchy {
  const sorted = [...permissions].sort((a, b) => comparePermissionIds(a.id, b.id));
  const opSets = new Map(sorted.map((p) => [p.id, new Set(p.operations)] as const));

  const edges: HierarchyEdge[] = [];
  const equivalentGroups = new Map<string, string[]>();

  for (let i = 0; i < sorted.length; i++) {
    for (let j = 0; j < sorted.length; j++) {
      if (i === j) continue;
      const a = sorted[i];
      const b = sorted[j];
      const setA = opSets.get(a.id)!;
      const setB = opSets.get(b.id)!;

      if (isStrictSubset(setA, setB)) {
        edges.push({ narrowerId: a.id, broaderId: b.id });
      } else if (i < j && setsEqual(setA, setB)) {
        const groupA = equivalentGroups.get(a.id) ?? [];
        groupA.push(b.id);
        equivalentGroups.set(a.id, groupA);
        const groupB = equivalentGroups.get(b.id) ?? [];
        groupB.push(a.id);
        equivalentGroups.set(b.id, groupB);
      }
    }
  }

  edges.sort(
    (x, y) =>
      comparePermissionIds(x.narrowerId, y.narrowerId) || comparePermissionIds(x.broaderId, y.broaderId),
  );
  for (const group of equivalentGroups.values()) group.sort(comparePermissionIds);

  assertNoCycles(edges);

  return { edges, equivalentGroups };
}

function assertNoCycles(edges: readonly HierarchyEdge[]): void {
  const broaderOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = broaderOf.get(edge.narrowerId) ?? [];
    list.push(edge.broaderId);
    broaderOf.set(edge.narrowerId, list);
  }

  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(
        `permission hierarchy cycle detected at ${id} — this indicates a bug in buildPermissionHierarchy, not a malformed registry`,
      );
    }
    visiting.add(id);
    for (const broader of broaderOf.get(id) ?? []) visit(broader);
    visiting.delete(id);
    done.add(id);
  }

  for (const id of broaderOf.keys()) visit(id);
}
