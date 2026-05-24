// supabase/functions/_shared/goal-steps/types.ts
//
// Types shared across goal-executor step handlers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface PlanStep {
  id: string;
  kind: string;
  title: string;
  rationale: string;
  params: Record<string, unknown>;
  depends_on: string[];
  estimated_hours?: number;
  success_criteria?: string;
}

export interface Plan { summary: string; steps: PlanStep[]; }

export type Mode = "dry_run" | "live";
export type StepStatus = "succeeded" | "failed" | "skipped";

export interface StepResult {
  status: StepStatus;
  output: Record<string, unknown>;
  error?: string;
}

export interface PausedSentinel { paused: true; not_before: string; }

/** Dispatch context passed to every live step handler. */
export interface StepContext {
  admin: ReturnType<typeof createClient>;
  userToken: string;
  userId: string;
  workspaceId: string;
  goal: { statement: string; target_metric: string };
  stepOutputs: Record<string, Record<string, unknown>>;
  /** Internal-function URL base (no trailing slash) for cross-fn POSTs. */
  supabaseUrl: string;
  geminiApiKey: string;
}

/** Each step module exports this shape. */
export interface StepHandler {
  kind: string;
  dryRun(step: PlanStep): StepResult;
  live(ctx: StepContext, step: PlanStep): Promise<StepResult | PausedSentinel>;
}
