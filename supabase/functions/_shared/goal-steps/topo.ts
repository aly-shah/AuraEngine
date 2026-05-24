// supabase/functions/_shared/goal-steps/topo.ts
//
// Topological sort over PlanStep[] using each step's `depends_on`. Returns
// the sorted list, or { error } on a missing dependency / cycle.

import type { PlanStep } from "./types.ts";

export function topoSort(steps: PlanStep[]): PlanStep[] | { error: string } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const s of steps) {
    indeg.set(s.id, (s.depends_on ?? []).length);
    for (const d of s.depends_on ?? []) {
      if (!byId.has(d)) return { error: `step ${s.id} depends on unknown step ${d}` };
      adj.set(d, [...(adj.get(d) ?? []), s.id]);
    }
  }
  const queue = steps.filter((s) => (indeg.get(s.id) ?? 0) === 0).map((s) => s.id);
  const ordered: PlanStep[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(byId.get(id)!);
    for (const nxt of adj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if ((indeg.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  if (ordered.length !== steps.length) return { error: "plan has dependency cycle" };
  return ordered;
}
