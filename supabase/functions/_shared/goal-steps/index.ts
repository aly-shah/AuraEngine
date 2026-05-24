// supabase/functions/_shared/goal-steps/index.ts
//
// Step registry + dispatcher for goal-executor. Each entry is one of the
// per-step handler modules (enrich.ts, score.ts, …) exposing the StepHandler
// shape { kind, dryRun, live }. Adding a new step kind = create a new
// module and register it here — no edits to the index.ts of goal-executor.

import * as enrich from "./enrich.ts";
import * as score from "./score.ts";
import * as team from "./team.ts";
import * as wait from "./wait.ts";
import * as checkpoint from "./checkpoint.ts";
import * as email from "./email.ts";
import * as social from "./social.ts";
import type {
  PausedSentinel,
  PlanStep,
  StepContext,
  StepHandler,
  StepResult,
} from "./types.ts";

const HANDLERS: Record<string, StepHandler> = {
  [enrich.kind]:     enrich,
  [score.kind]:      score,
  [team.kind]:       team,
  [wait.kind]:       wait,
  [checkpoint.kind]: checkpoint,
  [email.kind]:      email,
  [social.kind]:     social,
};

function unknownStep(step: PlanStep, mode: "dry_run" | "live"): StepResult {
  return {
    status: "skipped",
    output: { [mode === "dry_run" ? "dry_run" : "live"]: true, summary: `Unknown step kind "${step.kind}" — no-op.` },
    error: `Step kind "${step.kind}" is not supported by the executor.`,
  };
}

export function dryRunStep(step: PlanStep): StepResult {
  const h = HANDLERS[step.kind];
  if (!h) return unknownStep(step, "dry_run");
  return h.dryRun(step);
}

export async function executeStepLive(
  ctx: StepContext,
  step: PlanStep,
): Promise<StepResult | PausedSentinel> {
  const h = HANDLERS[step.kind];
  if (!h) return unknownStep(step, "live");
  return h.live(ctx, step);
}

export const STEP_KINDS = Object.keys(HANDLERS);

export type { PausedSentinel, PlanStep, StepContext, StepResult } from "./types.ts";
export type { StepStatus, Plan, Mode } from "./types.ts";
