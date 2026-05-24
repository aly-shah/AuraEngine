// AuraEngine/lib/goals.ts
//
// Phase 6.1 — Goal-based AI automation. Storage helpers + planner.
//
// The Planner takes a customer-stated goal (statement + target metric/value
// + guardrails) and produces a structured AutomationPlan. The plan is
// composed of canonical "automation primitives" — operations the existing
// platform already knows how to run (lead enrichment, lead scoring,
// sequence start, social post, etc). The goal-executor edge function
// walks the plan and invokes those primitives.

import { supabase } from './supabase';
import { getGeminiClient } from './geminiClient';
import { AI_MODELS } from './aiConfig';
import { buildMemoryContext, resolveWorkspaceForUser } from './memory';
import type { BusinessProfile } from '../types';

// ── Canonical primitive kinds ────────────────────────────────────────────
//
// The planner is constrained (via the system prompt + response schema) to
// emit ONLY these kinds. Phase 6.2's executor has a dispatcher keyed on
// this enum.

export const PRIMITIVE_KINDS = [
  'enrich_leads',        // Run AI research on a set of leads
  'lead_score',          // Score leads against ICP fit
  'email_sequence',      // Start an outreach sequence
  'social_post',         // Publish on LinkedIn/Twitter/Meta
  'team_task',           // Create a manual task in Team Hub
  'wait',                // Wait N hours/days before next step
  'checkpoint',          // Observer evaluates a metric vs threshold
] as const;
export type PrimitiveKind = typeof PRIMITIVE_KINDS[number];

export interface PlanStep {
  id: string;                          // Local-to-plan identifier ("s1", "s2")
  kind: PrimitiveKind;
  title: string;                       // Short label rendered in UI
  rationale: string;                   // Why this step
  params: Record<string, unknown>;     // Kind-specific parameters
  depends_on: string[];                // Other step IDs that must complete first
  estimated_hours: number;             // Planner's wall-clock estimate
  success_criteria?: string;           // Plain-language "what does done look like"
}

export interface AutomationPlan {
  summary: string;                     // 1-2 sentence overview
  estimated_total_hours: number;
  steps: PlanStep[];
  risks: string[];
  assumptions: string[];
}

export interface AutomationGoal {
  id: string;
  workspace_id: string;
  created_by: string | null;
  statement: string;
  target_metric: string;
  target_value: number;
  progress_value: number;
  due_at: string | null;
  status: 'draft' | 'planning' | 'planned' | 'active' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  guardrails: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AutomationPlanRow {
  id: string;
  goal_id: string;
  workspace_id: string;
  version: number;
  created_by_kind: 'planner' | 'replanner' | 'manual';
  plan: AutomationPlan;
  rationale: string | null;
  model_used: string | null;
  tokens_used: number | null;
  created_at: string;
  is_active: boolean;
  superseded_reason: string | null;
}

// ── CRUD ────────────────────────────────────────────────────────────────

export async function listGoals(workspaceId: string): Promise<AutomationGoal[]> {
  const { data, error } = await supabase
    .from('automation_goals')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AutomationGoal[];
}

export async function getGoal(goalId: string): Promise<AutomationGoal | null> {
  const { data, error } = await supabase
    .from('automation_goals')
    .select('*')
    .eq('id', goalId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AutomationGoal | null;
}

export async function getActivePlan(goalId: string): Promise<AutomationPlanRow | null> {
  const { data, error } = await supabase
    .from('automation_plans')
    .select('*')
    .eq('goal_id', goalId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AutomationPlanRow | null;
}

export async function listPlanVersions(goalId: string): Promise<AutomationPlanRow[]> {
  const { data, error } = await supabase
    .from('automation_plans')
    .select('*')
    .eq('goal_id', goalId)
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AutomationPlanRow[];
}

export async function createGoal(opts: {
  workspaceId: string;
  statement: string;
  targetMetric: string;
  targetValue: number;
  dueAt?: Date | null;
  guardrails?: string;
}): Promise<AutomationGoal> {
  const { data, error } = await supabase
    .from('automation_goals')
    .insert({
      workspace_id: opts.workspaceId,
      statement:    opts.statement,
      target_metric: opts.targetMetric,
      target_value:  opts.targetValue,
      due_at:        opts.dueAt ? opts.dueAt.toISOString() : null,
      guardrails:    opts.guardrails ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as AutomationGoal;
}

export async function updateGoalStatus(
  goalId: string,
  status: AutomationGoal['status'],
): Promise<void> {
  const patch: { status: AutomationGoal['status']; completed_at?: string } = { status };
  if (status === 'completed') patch.completed_at = new Date().toISOString();
  const { error } = await supabase.from('automation_goals').update(patch).eq('id', goalId);
  if (error) throw error;
}

export async function deleteGoal(goalId: string): Promise<void> {
  const { error } = await supabase.from('automation_goals').delete().eq('id', goalId);
  if (error) throw error;
}

// ── Planner ─────────────────────────────────────────────────────────────

const PLAN_SYSTEM_INSTRUCTION = `You are a senior B2B sales operations planner.
Given a customer goal and the available automation primitives, produce an
EXECUTABLE PLAN as a JSON object. The plan must be realistic, sequenced,
and grounded in B2B outbound best practices.

AVAILABLE PRIMITIVES — use ONLY these kinds:

  enrich_leads     Run AI lead research on a set of leads.
                   params: { lead_filter: '<step-id of upstream>' | 'workspace.new' }
                   typical_duration_hours: 2-4

  lead_score       Score leads against ICP fit. Outputs a "hot/warm/cold" segmentation.
                   params: { lead_filter: '<step-id>' | 'workspace.enriched' }
                   typical_duration_hours: 1

  email_sequence   Start a multi-step outreach sequence.
                   params: { sequence_template: 'cold_intro' | 'demo_invite' | 'reengage' | '...',
                             lead_filter: '<step-id>' | 'workspace.hot',
                             total_emails: int,
                             cadence_days: int }
                   typical_duration_hours: 24 to 168 (sequence wall time)

  social_post      Publish on LinkedIn / Twitter / Meta.
                   params: { channel: 'linkedin'|'twitter'|'meta', topic: text }
                   typical_duration_hours: 0.25

  team_task        Create a manual task for the human user(s).
                   params: { title: text, description?: text, assigned_role?: text }
                   typical_duration_hours: variable (human-driven)

  wait             Pure delay between steps.
                   params: { hours: int, reason: text }
                   typical_duration_hours: matches the wait

  checkpoint       Observer evaluates a metric vs threshold; goal pauses if missed.
                   params: { metric: 'replies'|'meetings_booked'|'qualified_leads'|...,
                             threshold: number, comparison: 'gte'|'lte' }
                   typical_duration_hours: 0

OUTPUT FORMAT — return a single JSON object matching this schema:

{
  "summary": "string — one or two sentences",
  "estimated_total_hours": number,
  "steps": [
    {
      "id": "s1" (unique within plan),
      "kind": one of the primitives above,
      "title": "short label, ~5 words",
      "rationale": "why this step, why now, how it advances the goal",
      "params": { primitive-specific },
      "depends_on": ["s0", "s1", ...] (empty for first step),
      "estimated_hours": number,
      "success_criteria": "what 'done' looks like for this step"
    }
  ],
  "risks": ["short risk descriptions"],
  "assumptions": ["short assumption descriptions"]
}

CONSTRAINTS:
- Between 3 and 12 steps. Less = under-planned; more = over-engineered.
- Place at least one checkpoint roughly halfway through.
- The final step's success_criteria should map directly to the goal's target.
- If guardrails forbid an action (e.g. "no cold email"), do not include it.
- Use workspace memory to bias toward winning_pattern and away from avoid.
- Output ONLY the JSON. No prose preamble. No code-fence wrappers.`;

interface PlanGenerationResult {
  plan: AutomationPlan;
  rationale: string;
  tokensUsed: number;
  modelUsed: string;
}

/**
 * Phase 6.1 — Generate an automation plan for a goal.
 *
 * Pulls workspace memory (winning_pattern + avoid) and any provided
 * business profile context into the prompt. Returns a structured plan
 * + the LLM's rationale + telemetry.
 *
 * Caller is responsible for persisting via storePlanVersion().
 */
export async function generateGoalPlan(opts: {
  goal: Pick<AutomationGoal, 'statement' | 'target_metric' | 'target_value' | 'due_at' | 'guardrails'>;
  workspaceId: string;
  userId: string;
  businessProfile?: BusinessProfile | null;
}): Promise<PlanGenerationResult> {
  const memoryCtx = await buildMemoryContext({
    workspaceId: opts.workspaceId,
    workspaceKinds: ['winning_pattern', 'avoid', 'tone', 'preference', 'usp', 'fact'],
  }).catch(() => '');

  const bp = opts.businessProfile;
  const businessCtx = bp ? [
    bp.companyName     ? `Company: ${bp.companyName}` : null,
    bp.industry        ? `Industry: ${bp.industry}` : null,
    bp.valueProp       ? `Value Prop: ${bp.valueProp}` : null,
    bp.targetAudience  ? `Target Audience: ${bp.targetAudience}` : null,
    bp.salesApproach   ? `Sales Approach: ${bp.salesApproach}` : null,
  ].filter(Boolean).join('\n') : '';

  const userPrompt = `GOAL
====
Statement:    ${opts.goal.statement}
Target:       ${opts.goal.target_value} ${opts.goal.target_metric}
Due by:       ${opts.goal.due_at ? new Date(opts.goal.due_at).toISOString().slice(0, 10) : 'no deadline'}
Guardrails:   ${opts.goal.guardrails ?? '(none)'}

BUSINESS CONTEXT
================
${businessCtx || '(none provided)'}
${memoryCtx}

Generate the plan now. JSON only.`;

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: AI_MODELS.text,
    contents: userPrompt,
    config: {
      systemInstruction: PLAN_SYSTEM_INSTRUCTION,
      temperature: 0.6,
      topP: 0.9,
      topK: 40,
      responseMimeType: 'application/json',
    },
  });

  const rawText = response.text ?? '';
  // Strip any ```json fences the model might emit despite instructions.
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: AutomationPlan;
  try {
    parsed = JSON.parse(cleaned) as AutomationPlan;
  } catch (e) {
    throw new Error(`Planner returned non-JSON: ${(e as Error).message}. First 200 chars: ${cleaned.slice(0, 200)}`);
  }

  // Lightweight schema validation. If the model drifts, we want to catch
  // it here rather than break the executor downstream.
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error('Planner returned no steps');
  }
  for (const step of parsed.steps) {
    if (!PRIMITIVE_KINDS.includes(step.kind as PrimitiveKind)) {
      throw new Error(`Planner emitted unknown step kind: ${step.kind}`);
    }
  }

  return {
    plan: parsed,
    rationale: parsed.summary ?? '',
    tokensUsed: response.usageMetadata?.totalTokenCount ?? 0,
    modelUsed: AI_MODELS.text,
  };
}

/**
 * Persist a plan version via the SECURITY DEFINER RPC. Deactivates any
 * prior active plan + advances goal status from draft/planning → planned.
 */
export async function storePlanVersion(opts: {
  goalId: string;
  plan: AutomationPlan;
  rationale?: string;
  createdByKind?: 'planner' | 'replanner' | 'manual';
  modelUsed?: string;
  tokensUsed?: number;
  supersededReason?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('store_plan_version', {
    p_goal_id:           opts.goalId,
    p_plan:              opts.plan,
    p_rationale:         opts.rationale ?? null,
    p_created_by_kind:   opts.createdByKind ?? 'planner',
    p_model_used:        opts.modelUsed ?? null,
    p_tokens_used:       opts.tokensUsed ?? null,
    p_superseded_reason: opts.supersededReason ?? 'newer plan',
  });
  if (error) throw error;
  return data as string;
}

/**
 * Convenience: resolve workspace + call generateGoalPlan + storePlanVersion
 * in one round-trip. Returns the new plan row id.
 */
export async function planAndStoreFromGoal(opts: {
  goal: AutomationGoal;
  userId: string;
  businessProfile?: BusinessProfile | null;
}): Promise<{ planId: string; tokensUsed: number }> {
  // Mark planning in progress so the UI can show a spinner without polling.
  await supabase.from('automation_goals').update({ status: 'planning' }).eq('id', opts.goal.id);

  try {
    const result = await generateGoalPlan({
      goal: opts.goal,
      workspaceId: opts.goal.workspace_id,
      userId: opts.userId,
      businessProfile: opts.businessProfile,
    });
    const planId = await storePlanVersion({
      goalId:       opts.goal.id,
      plan:         result.plan,
      rationale:    result.rationale,
      createdByKind: 'planner',
      modelUsed:    result.modelUsed,
      tokensUsed:   result.tokensUsed,
    });
    return { planId, tokensUsed: result.tokensUsed };
  } catch (e) {
    // On failure, revert status so user can retry.
    await supabase.from('automation_goals').update({ status: 'draft' }).eq('id', opts.goal.id);
    throw e;
  }
}

export { resolveWorkspaceForUser };

// ── Step runs (Phase 6.2.a) ──────────────────────────────────────────────

export interface AutomationStepRun {
  id: string;
  plan_id: string;
  goal_id: string;
  workspace_id: string;
  step_id: string;
  step_kind: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  mode: 'dry_run' | 'live';
  attempt_count: number;
  input_params: unknown;
  output: { dry_run?: boolean; summary?: string; [k: string]: unknown } | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function listStepRunsForPlan(planId: string): Promise<AutomationStepRun[]> {
  const { data, error } = await supabase
    .from('automation_step_runs')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AutomationStepRun[];
}

/**
 * Phase 6.2.a — invoke the goal-executor edge function in dry-run mode.
 */
export async function runPlanPreview(goalId: string): Promise<ExecutorResponse> {
  return invokeExecutor(goalId, 'dry_run');
}

/**
 * Phase 6.2.b — invoke the goal-executor in live mode.
 * Requires the workspace to have feature flag `goal_executor_live = true`.
 * Throws if the flag is off.
 */
export async function runPlanLive(goalId: string): Promise<ExecutorResponse> {
  return invokeExecutor(goalId, 'live');
}

export interface ExecutorResponse {
  goal_id: string;
  plan_id: string;
  mode: 'dry_run' | 'live';
  steps_total: number;
  steps_succeeded: number;
  steps_skipped?: number;
  steps_failed: number;
  step_run_ids: string[];
  final_status: 'completed' | 'failed';
}

async function invokeExecutor(goalId: string, mode: 'dry_run' | 'live'): Promise<ExecutorResponse> {
  const { data, error } = await supabase.functions.invoke('goal-executor', {
    body: { goal_id: goalId, mode },
  });
  if (error) throw new Error(error.message ?? 'goal-executor invocation failed');
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ExecutorResponse;
}

// ── Workspace feature flags (Phase 6.2.b + 6.2.d) ────────────────────────

export const LIVE_MODE_FLAG   = 'goal_executor_live';
export const SEND_EMAIL_FLAG  = 'goal_executor_send_email';
export const SEND_SOCIAL_FLAG = 'goal_executor_send_social';

export async function isFlagEnabled(workspaceId: string, flagKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('workspace_feature_flags')
    .select('enabled')
    .eq('workspace_id', workspaceId)
    .eq('flag_key', flagKey)
    .maybeSingle();
  if (error) return false;
  return data?.enabled === true;
}

export async function setFlagEnabled(workspaceId: string, flagKey: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('workspace_feature_flags')
    .upsert({
      workspace_id: workspaceId,
      flag_key:     flagKey,
      enabled,
      set_at:       new Date().toISOString(),
    }, { onConflict: 'workspace_id,flag_key' });
  if (error) throw error;
}

// Back-compat thin wrappers for existing callers.
export async function isLiveModeEnabled(workspaceId: string): Promise<boolean> {
  return isFlagEnabled(workspaceId, LIVE_MODE_FLAG);
}
export async function setLiveModeEnabled(workspaceId: string, enabled: boolean): Promise<void> {
  return setFlagEnabled(workspaceId, LIVE_MODE_FLAG, enabled);
}

// ── Observations + auto-replanner (Phase 6.3 + 6.3.b) ───────────────────

export interface GoalObservation {
  created_at: string;
  kind: string;                            // 'past_due_with_unmet_target' | 'paused_too_long' | 'stalled_running' | ...
  value: Record<string, unknown>;          // full observation body
}

export interface GoalObservationCount {
  goal_id: string;
  observation_count: number;
  latest_kind: string | null;
  latest_at: string;
}

/**
 * Observations are written workspace-wide by the goal observer cron with
 * key='goal:<id>'. This helper filters to one goal's observations within
 * the last `sinceHours` window (defaulting to 7 days for context, since
 * the UI's drift chip only cares about the freshest one).
 */
export async function listGoalObservations(
  workspaceId: string,
  goalId: string,
  sinceHours = 168,
): Promise<GoalObservation[]> {
  const cutoff = new Date(Date.now() - sinceHours * 3600_000).toISOString();
  const { data, error } = await supabase
    .from('workspace_memory')
    .select('created_at, value')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'observation')
    .eq('key', `goal:${goalId}`)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    created_at: r.created_at as string,
    kind: ((r.value as { kind?: string })?.kind) ?? 'unknown',
    value: (r.value as Record<string, unknown>) ?? {},
  }));
}

/**
 * Workspace-wide aggregate via the SECURITY DEFINER RPC. Used by the
 * goals list to badge cards with drift chips without round-tripping per
 * goal.
 */
export async function getGoalObservationCounts(workspaceId: string): Promise<Record<string, GoalObservationCount>> {
  const { data, error } = await supabase.rpc('recent_goal_observation_counts', { p_workspace_id: workspaceId });
  if (error) throw error;
  const byId: Record<string, GoalObservationCount> = {};
  for (const row of (data ?? []) as GoalObservationCount[]) {
    byId[row.goal_id] = row;
  }
  return byId;
}

export interface ReplannerResponse {
  goal_id: string;
  plan_id: string;
  version: number;
  superseded_reason: string;
  observations_used: number;
  tokens_used: number;
  triggered_by: 'user' | 'cron';
}

/**
 * Phase 6.3.b — manually trigger the LLM replanner for a goal. The
 * goal-replanner edge function reads observations + outcomes, calls
 * Gemini for a revised plan, and persists it via store_plan_version.
 * Pass `force=true` to bypass the 6h cooldown and the no-observations
 * guard.
 */
export async function runReplan(goalId: string, force = false): Promise<ReplannerResponse> {
  const { data, error } = await supabase.functions.invoke('goal-replanner', {
    body: { goal_id: goalId, force },
  });
  if (error) throw new Error(error.message ?? 'goal-replanner invocation failed');
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ReplannerResponse;
}

export const OBSERVATION_LABELS: Record<string, { label: string; tone: string }> = {
  past_due_with_unmet_target: { label: 'Past due, target unmet',          tone: 'rose'   },
  paused_too_long:            { label: 'Paused over 12h',                  tone: 'amber'  },
  stalled_running:            { label: 'No step progress for 6h',          tone: 'amber'  },
};
