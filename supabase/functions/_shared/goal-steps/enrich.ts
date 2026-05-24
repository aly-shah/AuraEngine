// supabase/functions/_shared/goal-steps/enrich.ts
//
// enrich_leads: pulls up to ENRICH_MAX_LEADS workspace leads with empty
// insights and writes a 2-3 sentence Gemini-produced research note onto each.

import { geminiGenerate } from "./gemini.ts";
import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "enrich_leads";
const ENRICH_MAX_LEADS = 20;

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would run AI research on leads from ${p.lead_filter ?? "upstream step"} (~2-4 hours typical wall time).`,
      simulated_enriched: 38,
      simulated_failed: 4,
    },
  };
}

export async function live(ctx: StepContext, _step: PlanStep): Promise<StepResult> {
  const { admin, workspaceId, geminiApiKey } = ctx;
  try {
    const { data: leads, error } = await admin
      .from("leads")
      .select("id, first_name, last_name, primary_email, company, title, linkedin_url, insights, workspace_id")
      .eq("workspace_id", workspaceId)
      .or("insights.is.null,insights.eq.")
      .limit(ENRICH_MAX_LEADS);
    if (error) return { status: "failed", output: { live: true }, error: `lead fetch failed: ${error.message}` };
    if (!leads || leads.length === 0) {
      return { status: "succeeded", output: { live: true, summary: "No leads needed enrichment.", enriched: 0 } };
    }

    let enriched = 0;
    let failed = 0;
    for (const l of leads) {
      const prompt = `Research this B2B prospect and produce a 2-3 sentence insight on their likely pain points and the best opening hook for outreach. Return plain text, no preamble.\n\nName: ${l.first_name ?? ""} ${l.last_name ?? ""}\nTitle: ${l.title ?? "unknown"}\nCompany: ${l.company ?? "unknown"}\nEmail: ${l.primary_email ?? "(none)"}\nLinkedIn: ${l.linkedin_url ?? "(none)"}`;
      try {
        const { text } = await geminiGenerate(geminiApiKey, prompt, "You are a B2B sales researcher producing terse, useful prospect insights.");
        await admin.from("leads").update({ insights: text.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", l.id);
        enriched++;
      } catch (e) {
        console.warn(`[enrich] lead ${l.id} failed:`, (e as Error).message);
        failed++;
      }
    }

    return {
      status: failed === leads.length ? "failed" : "succeeded",
      output: {
        live: true,
        summary: `Enriched ${enriched} of ${leads.length} leads (${failed} failed). Insights written to leads.insights.`,
        enriched, failed, total: leads.length,
      },
      error: failed > 0 ? `${failed} lead(s) failed enrichment — see edge fn logs.` : undefined,
    };
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `enrich_leads threw: ${(e as Error).message}` };
  }
}
