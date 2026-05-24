// supabase/functions/_shared/goal-steps/score.ts
//
// lead_score: scores up to SCORE_MAX_LEADS workspace leads 0-100 against ICP
// using Gemini, writes back to leads.score, and tallies hot/warm/cold.

import { geminiGenerate } from "./gemini.ts";
import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "lead_score";
const SCORE_MAX_LEADS = 50;

export function dryRun(_step: PlanStep): StepResult {
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would score leads against your ICP. Typical result: 60% scored, 20% hot, 40% warm, 40% cold.`,
      simulated_hot: 8,
      simulated_warm: 16,
      simulated_cold: 16,
    },
  };
}

export async function live(ctx: StepContext, _step: PlanStep): Promise<StepResult> {
  const { admin, workspaceId, geminiApiKey } = ctx;
  try {
    const { data: leads, error } = await admin
      .from("leads")
      .select("id, first_name, last_name, company, title, industry, insights, score")
      .eq("workspace_id", workspaceId)
      .or("score.is.null,score.eq.0")
      .limit(SCORE_MAX_LEADS);
    if (error) return { status: "failed", output: { live: true }, error: `lead fetch failed: ${error.message}` };
    if (!leads || leads.length === 0) {
      return { status: "succeeded", output: { live: true, summary: "No leads needed scoring.", scored: 0 } };
    }

    let scored = 0, failed = 0, hot = 0, warm = 0, cold = 0;
    for (const l of leads) {
      const prompt = `Score this B2B prospect 0-100 for ICP fit. Output JSON ONLY: {"score": int, "tier": "hot"|"warm"|"cold", "reason": "one sentence"}.\n\nProspect: ${l.first_name} ${l.last_name}, ${l.title} at ${l.company} (${l.industry ?? "unknown industry"}).\nInsights: ${l.insights ?? "(none)"}`;
      try {
        const { text } = await geminiGenerate(geminiApiKey, prompt, "You are a B2B ICP scorer. Output strict JSON only.", { responseMimeType: "application/json" });
        const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(cleaned) as { score: number; tier: string };
        const s = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
        await admin.from("leads").update({ score: s, updated_at: new Date().toISOString() }).eq("id", l.id);
        scored++;
        if (parsed.tier === "hot") hot++;
        else if (parsed.tier === "warm") warm++;
        else cold++;
      } catch (e) {
        console.warn(`[score] lead ${l.id} failed:`, (e as Error).message);
        failed++;
      }
    }

    return {
      status: failed === leads.length ? "failed" : "succeeded",
      output: {
        live: true,
        summary: `Scored ${scored} of ${leads.length} leads. Hot: ${hot}, Warm: ${warm}, Cold: ${cold}.`,
        scored, failed, hot, warm, cold, total: leads.length,
      },
      error: failed > 0 ? `${failed} lead(s) failed scoring.` : undefined,
    };
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `lead_score threw: ${(e as Error).message}` };
  }
}
