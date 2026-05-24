// supabase/functions/_shared/goal-steps/flags.ts
//
// Workspace feature-flag helpers used by step handlers to gate destructive
// primitives (email send, social post) behind explicit per-workspace opt-in.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { StepResult } from "./types.ts";

export const LIVE_MODE_FLAG = "goal_executor_live";
export const SEND_EMAIL_FLAG = "goal_executor_send_email";
export const SEND_SOCIAL_FLAG = "goal_executor_send_social";

export async function flagEnabled(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  flagKey: string,
): Promise<boolean> {
  const { data } = await admin.rpc("workspace_has_flag", {
    p_workspace_id: workspaceId,
    p_flag_key: flagKey,
  });
  return data === true;
}

export function gatedSkip(stepKind: string, flagKey: string): StepResult {
  return {
    status: "skipped",
    output: {
      live: true,
      gated: true,
      summary: `"${stepKind}" requires workspace flag "${flagKey}" — not enabled. Skipped.`,
      flag_key: flagKey,
    },
    error: `"${stepKind}" is gated behind the ${flagKey} workspace flag. Enable it explicitly before this primitive will execute.`,
  };
}
