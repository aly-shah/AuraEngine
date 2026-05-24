// supabase/functions/_shared/goal-steps/leads.ts
//
// Resolves a lead_filter param (workspace.hot, step:s2, etc.) to a concrete
// list of leads for email_sequence and other downstream primitives.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const EMAIL_LEADS_CAP = 100;

export interface ResolvedLead {
  id: string;
  primary_email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  industry: string | null;
  insights: string | null;
  score: number | null;
  status: string | null;
}

export async function resolveLeads(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  filter: string | undefined,
  stepOutputs: Record<string, Record<string, unknown>>,
): Promise<{ leads: ResolvedLead[]; source: string }> {
  const cleaned = (filter ?? "workspace.hot").trim();
  let source = cleaned;

  // Step-reference lookup: 'step:s1' or 's1'
  const stepRefMatch = cleaned.match(/^(?:step:)?(s\d+)$/i);
  if (stepRefMatch) {
    const refId = stepRefMatch[1];
    const upstream = stepOutputs[refId];
    const ids = (upstream?.lead_ids as string[] | undefined) ?? [];
    if (ids.length > 0) {
      const { data } = await admin
        .from("leads")
        .select("id, primary_email, first_name, last_name, company, title, industry, insights, score, status")
        .eq("workspace_id", workspaceId)
        .in("id", ids.slice(0, EMAIL_LEADS_CAP))
        .not("primary_email", "is", null);
      return { leads: (data ?? []) as ResolvedLead[], source: `step:${refId}` };
    }
    source = `step:${refId} (fallback workspace.new)`;
  }

  let q = admin
    .from("leads")
    .select("id, primary_email, first_name, last_name, company, title, industry, insights, score, status")
    .eq("workspace_id", workspaceId)
    .not("primary_email", "is", null)
    .limit(EMAIL_LEADS_CAP);

  if (cleaned === "workspace.hot") {
    q = q.gte("score", 70).order("score", { ascending: false });
  } else if (cleaned === "workspace.warm") {
    q = q.gte("score", 40).lt("score", 70).order("score", { ascending: false });
  } else if (cleaned === "workspace.cold") {
    q = q.or("score.is.null,score.lt.40").order("created_at", { ascending: false });
  } else {
    q = q.order("created_at", { ascending: false });
  }
  const { data } = await q;
  return { leads: (data ?? []) as ResolvedLead[], source };
}
