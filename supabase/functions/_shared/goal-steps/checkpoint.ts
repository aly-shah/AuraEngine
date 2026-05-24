// supabase/functions/_shared/goal-steps/checkpoint.ts
//
// checkpoint: reads a named workspace metric and compares it to a threshold.
// Evaluation always 'succeeds'; the pass/miss outcome is in output.passed.

import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "checkpoint";

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would evaluate metric "${p.metric ?? "?"}" against threshold ${p.comparison ?? ""} ${p.threshold ?? "?"}.`,
      metric: p.metric,
      threshold: p.threshold,
      comparison: p.comparison,
      simulated_outcome: "would_pass",
    },
  };
}

export async function live(ctx: StepContext, step: PlanStep): Promise<StepResult> {
  const { admin, workspaceId, goal } = ctx;
  const p = step.params ?? {};
  const metric = String(p.metric ?? goal.target_metric);
  const threshold = Number(p.threshold ?? 0);
  const comparison = String(p.comparison ?? "gte");

  let observed: number | null = null;
  let queryNote = "";
  try {
    if (metric === "leads_total" || metric === "leads") {
      const { count } = await admin.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      observed = count ?? 0;
      queryNote = "leads (workspace, all-time)";
    } else if (metric === "leads_new_30d") {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { count } = await admin.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).gte("created_at", since);
      observed = count ?? 0;
      queryNote = "leads created in last 30 days";
    } else if (metric === "qualified_leads") {
      const { count } = await admin.from("leads").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("status", "Qualified");
      observed = count ?? 0;
      queryNote = "leads with status=Qualified";
    } else if (metric === "emails_sent_in_range" || metric === "email_sent") {
      const { count } = await admin.from("email_messages").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId);
      observed = count ?? 0;
      queryNote = "email_messages (workspace, all-time)";
    } else if (metric === "active_sequences") {
      const { count } = await admin.from("email_sequence_runs").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId).eq("status", "processing");
      observed = count ?? 0;
      queryNote = "email_sequence_runs status=processing";
    } else {
      return {
        status: "skipped",
        output: { live: true, summary: `Checkpoint metric "${metric}" is not in the live-mode metric catalogue yet.` },
        error: `Unsupported metric "${metric}" — supported: leads_total, leads_new_30d, qualified_leads, emails_sent_in_range, active_sequences.`,
      };
    }
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `checkpoint query failed: ${(e as Error).message}` };
  }

  const passed = comparison === "gte" ? (observed ?? 0) >= threshold
               : comparison === "lte" ? (observed ?? 0) <= threshold
               : comparison === "eq"  ? (observed ?? 0) === threshold
               : false;

  return {
    status: "succeeded",
    output: {
      live: true,
      summary: `Checkpoint: ${queryNote} = ${observed} (target ${comparison} ${threshold}) → ${passed ? "PASS" : "MISS"}.`,
      metric,
      observed,
      threshold,
      comparison,
      passed,
    },
    error: passed ? undefined : `Checkpoint missed: ${observed} ${comparison} ${threshold} = false`,
  };
}
