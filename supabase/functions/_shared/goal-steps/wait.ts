// supabase/functions/_shared/goal-steps/wait.ts
//
// wait: two regimes.
//   ≤30s wait: inline sleep, succeed immediately.
//   >30s wait: return a PausedSentinel so the dispatcher persists not_before
//              and pauses the goal. pg_cron resumes the executor in resume
//              mode when not_before <= now().

import type { PausedSentinel, PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "wait";
const INLINE_WAIT_MAX_MS = 30_000;

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would wait ${p.hours ?? "?"} hours. Reason: ${p.reason ?? "(none)"}.`,
      hours: p.hours,
    },
  };
}

export async function live(_ctx: StepContext, step: PlanStep): Promise<StepResult | PausedSentinel> {
  const hours = Number(step.params?.hours ?? 0);
  const reason = String(step.params?.reason ?? "");
  const ms = Math.max(0, hours * 3_600_000);

  if (ms <= INLINE_WAIT_MAX_MS) {
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    return {
      status: "succeeded",
      output: { live: true, summary: `Waited ${hours}h inline (≤30s) — resumed.`, hours, reason },
    };
  }

  const notBefore = new Date(Date.now() + ms).toISOString();
  return { paused: true, not_before: notBefore };
}
