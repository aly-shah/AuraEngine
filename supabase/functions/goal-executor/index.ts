// supabase/functions/goal-executor/index.ts
//
// Goal executor entry point.
//
//   POST /functions/v1/goal-executor
//   body: { goal_id: <uuid>, mode?: "dry_run" | "live", resume?: boolean }
//   Auth: Supabase user JWT (caller must be a member of the goal's workspace).
//         Cron-resume path uses the service-role token.
//
// Mode gating:
//   dry_run     ALWAYS allowed. All primitives return "would have done X" stubs.
//   live        Requires the workspace to have feature flag
//               `goal_executor_live = true`. Returns 403 otherwise.
//
// Live primitives are registered in _shared/goal-steps/index.ts. Adding a new
// step kind = create a new module under _shared/goal-steps/ and register it
// there — no edits needed in this file.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { SUPABASE_URL, adminClient, bearerToken } from "../_shared/auth.ts";
import {
  dryRunStep,
  executeStepLive,
  type PausedSentinel,
  type Plan,
  type StepResult,
} from "../_shared/goal-steps/index.ts";
import { topoSort } from "../_shared/goal-steps/topo.ts";
import { LIVE_MODE_FLAG } from "../_shared/goal-steps/flags.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MAX_STEPS_PER_PLAN = 25;
type Mode = "dry_run" | "live";

function jsonResponse(b: unknown, status: number, h: Record<string, string>): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...h, "Content-Type": "application/json" } });
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);

  const userToken = bearerToken(req);
  if (!userToken) return jsonResponse({ error: "Missing Authorization" }, 401, corsHeaders);

  const admin = adminClient();
  const { data: userRes, error: authErr } = await admin.auth.getUser(userToken);
  if (authErr || !userRes?.user) return jsonResponse({ error: "Invalid token" }, 401, corsHeaders);
  const userId = userRes.user.id;

  const body = await req.json().catch(() => ({} as { goal_id?: string; mode?: string; resume?: boolean }));
  if (!body.goal_id || typeof body.goal_id !== "string") {
    return jsonResponse({ error: "goal_id required" }, 400, corsHeaders);
  }
  const mode: Mode = body.mode === "live" ? "live" : "dry_run";
  const resume: boolean = body.resume === true;

  const { data: goal, error: goalErr } = await admin
    .from("automation_goals")
    .select("id, workspace_id, statement, status, target_value, target_metric")
    .eq("id", body.goal_id)
    .maybeSingle();
  if (goalErr || !goal) return jsonResponse({ error: "Goal not found" }, 404, corsHeaders);

  const { data: membership } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", goal.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return jsonResponse({ error: "Forbidden" }, 403, corsHeaders);

  if (mode === "live") {
    const { data: flagOn } = await admin.rpc("workspace_has_flag", {
      p_workspace_id: goal.workspace_id,
      p_flag_key:     LIVE_MODE_FLAG,
    });
    if (!flagOn) {
      return jsonResponse({
        error: "Live execution requires the goal_executor_live workspace flag to be enabled.",
        code:  "live_not_enabled",
        flag_key: LIVE_MODE_FLAG,
      }, 403, corsHeaders);
    }
  }

  if (!["planned", "active", "paused", "running", "completed", "failed"].includes(goal.status)) {
    return jsonResponse({
      error: `Goal must be planned/active/paused/running/completed/failed to execute; current status is "${goal.status}"`,
      code:  "wrong_status",
    }, 409, corsHeaders);
  }

  const { data: planRow, error: planErr } = await admin
    .from("automation_plans")
    .select("id, plan")
    .eq("goal_id", goal.id)
    .eq("is_active", true)
    .maybeSingle();
  if (planErr || !planRow) return jsonResponse({ error: "No active plan for this goal" }, 404, corsHeaders);

  const plan = planRow.plan as Plan;
  if (!plan.steps || plan.steps.length === 0) return jsonResponse({ error: "Plan has no steps" }, 400, corsHeaders);
  if (plan.steps.length > MAX_STEPS_PER_PLAN) return jsonResponse({ error: `Plan has ${plan.steps.length} steps; cap is ${MAX_STEPS_PER_PLAN}`, code: "too_many_steps" }, 400, corsHeaders);

  const ordered = topoSort(plan.steps);
  if ("error" in ordered) return jsonResponse({ error: ordered.error }, 400, corsHeaders);

  // In resume mode (called by cron), pick up where we left off.
  let alreadyDoneStepIds = new Set<string>();
  if (resume) {
    const { data: existing } = await admin
      .from("automation_step_runs")
      .select("step_id, status")
      .eq("plan_id", planRow.id)
      .in("status", ["succeeded", "skipped", "failed"]);
    alreadyDoneStepIds = new Set((existing ?? []).map((r) => r.step_id as string));
  }

  await admin.rpc("set_goal_status", { p_goal_id: goal.id, p_status: "running" });

  const progressIncrement = goal.target_value > 0
    ? Math.max(1, Math.floor(goal.target_value / Math.max(1, ordered.length)))
    : 0;

  const stepRunIds: string[] = [];
  let failures = 0;
  let skipped = 0;
  let pausedAt: { step_id: string; not_before: string } | null = null;

  // Step-output passing: downstream primitives (currently email_sequence)
  // can reference upstream step outputs by id via `lead_filter: 'step:s1'`.
  // We preload completed step outputs on resume so the chain stays intact.
  const stepOutputs: Record<string, Record<string, unknown>> = {};
  if (resume) {
    const { data: priorRuns } = await admin
      .from("automation_step_runs")
      .select("step_id, output, status")
      .eq("plan_id", planRow.id)
      .eq("status", "succeeded");
    for (const r of priorRuns ?? []) {
      if (r.output && typeof r.output === "object") {
        stepOutputs[r.step_id as string] = r.output as Record<string, unknown>;
      }
    }
  }

  const stepCtx = {
    admin,
    userToken,
    userId,
    workspaceId: goal.workspace_id,
    goal: { statement: goal.statement, target_metric: goal.target_metric },
    stepOutputs,
    supabaseUrl: SUPABASE_URL,
    geminiApiKey: GEMINI_API_KEY,
  };

  for (const step of ordered) {
    if (alreadyDoneStepIds.has(step.id)) continue;

    // Insert or claim the step_run row. In resume mode the row may exist;
    // reuse it. Otherwise insert a fresh one.
    let stepRunId: string;
    if (resume) {
      const { data: existing } = await admin
        .from("automation_step_runs")
        .select("id")
        .eq("plan_id", planRow.id)
        .eq("step_id", step.id)
        .order("attempt_count", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        stepRunId = existing.id;
        await admin.from("automation_step_runs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", stepRunId);
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("automation_step_runs")
          .insert({
            plan_id: planRow.id, goal_id: goal.id, workspace_id: goal.workspace_id,
            step_id: step.id, step_kind: step.kind, status: "running", mode,
            attempt_count: 1, input_params: step.params ?? {}, started_at: new Date().toISOString(),
          })
          .select("id").single();
        if (insErr || !inserted) { failures++; continue; }
        stepRunId = inserted.id;
      }
    } else {
      const { data: inserted, error: insErr } = await admin
        .from("automation_step_runs")
        .insert({
          plan_id: planRow.id, goal_id: goal.id, workspace_id: goal.workspace_id,
          step_id: step.id, step_kind: step.kind, status: "running", mode,
          attempt_count: 1, input_params: step.params ?? {}, started_at: new Date().toISOString(),
        })
        .select("id").single();
      if (insErr || !inserted) { failures++; continue; }
      stepRunId = inserted.id;
    }
    stepRunIds.push(stepRunId);

    const result: StepResult | PausedSentinel = mode === "live"
      ? await executeStepLive(stepCtx, step)
      : dryRunStep(step);

    if ("paused" in result && result.paused) {
      await admin.from("automation_step_runs").update({
        status: "pending", not_before: result.not_before, started_at: null,
        output: { live: true, paused: true, summary: `Paused — will resume at ${result.not_before}.`, not_before: result.not_before },
      }).eq("id", stepRunId);
      pausedAt = { step_id: step.id, not_before: result.not_before };
      break;
    }

    if (result.status === "failed") failures++;
    if (result.status === "skipped") skipped++;
    if (result.status === "succeeded") stepOutputs[step.id] = result.output;

    await admin
      .from("automation_step_runs")
      .update({
        status:       result.status,
        output:       result.output,
        error:        result.error ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", stepRunId);

    if (progressIncrement > 0 && result.status === "succeeded") {
      await admin.rpc("advance_goal_progress", {
        p_goal_id:   goal.id,
        p_increment: progressIncrement,
      });
    }
  }

  const finalStatus = pausedAt
    ? "paused"
    : failures === 0 ? "completed" : "failed";
  await admin.rpc("set_goal_status", { p_goal_id: goal.id, p_status: finalStatus });

  return jsonResponse({
    goal_id:       goal.id,
    plan_id:       planRow.id,
    mode,
    resume,
    paused_at:     pausedAt,
    steps_total:   ordered.length,
    steps_succeeded: stepRunIds.length - failures - skipped - (pausedAt ? 1 : 0),
    steps_skipped: skipped,
    steps_failed:  failures,
    step_run_ids:  stepRunIds,
    final_status:  finalStatus,
  }, 200, corsHeaders);
});
