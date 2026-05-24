// supabase/functions/_shared/goal-steps/email.ts
//
// email_sequence: resolves leads, AI-generates a multi-step sequence body,
// and POSTs to start-email-sequence-run. Gated on goal_executor_send_email.

import { isServiceRoleToken } from "../auth.ts";
import { geminiGenerate } from "./gemini.ts";
import { flagEnabled, gatedSkip, SEND_EMAIL_FLAG } from "./flags.ts";
import { resolveLeads } from "./leads.ts";
import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "email_sequence";

const TEMPLATE_CATEGORY_MAP: Record<string, string> = {
  cold_intro:   "welcome",
  intro:        "welcome",
  welcome:      "welcome",
  demo_invite:  "demo_invite",
  demo:         "demo_invite",
  case_study:   "case_study",
  case_studies: "case_study",
  follow_up:    "follow_up",
  followup:     "follow_up",
  nurture:      "nurture",
  reengage:     "nurture",
  re_engage:    "nurture",
  reactivation: "nurture",
};

interface GeneratedStep { stepIndex: number; delayDays: number; subject: string; body: string; }

async function generateSequenceSteps(
  geminiApiKey: string,
  opts: {
    totalEmails: number;
    cadenceDays: number;
    templateCategory: string;
    goalStatement: string;
    audienceHint: string;
  },
): Promise<GeneratedStep[]> {
  const { totalEmails, cadenceDays, templateCategory, goalStatement, audienceHint } = opts;
  const system = `You are a senior B2B outbound copywriter. Produce a tight cold-outreach sequence with deliberate variety across touches — first message hooks, follow-ups remind/add value, final message proposes next step. No "Hope this email finds you well." No emojis. Subject lines under 60 chars. Bodies under 140 words. Use {{first_name}} and {{company}} merge tokens where natural.`;
  const prompt = `Write a ${totalEmails}-step ${templateCategory} sequence targeting: ${audienceHint}.
Goal of the sequence: ${goalStatement}.
Cadence: ${cadenceDays} day(s) between sends.

Return JSON ONLY in this shape:
{"steps": [{"stepIndex": 1, "delayDays": 0, "subject": "...", "body": "..."}, ...]}

Rules:
- stepIndex starts at 1
- step 1 has delayDays=0; subsequent steps have delayDays=${cadenceDays}
- exactly ${totalEmails} entries
- plain text body (no HTML); use \\n for line breaks`;

  const { text } = await geminiGenerate(geminiApiKey, prompt, system, { responseMimeType: "application/json" });
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned) as { steps: GeneratedStep[] };
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error("Gemini returned no sequence steps");
  }
  return parsed.steps
    .slice(0, totalEmails)
    .map((s, i) => ({
      stepIndex: i + 1,
      delayDays: i === 0 ? 0 : (s.delayDays ?? cadenceDays),
      subject: String(s.subject ?? "").slice(0, 200),
      body:    String(s.body ?? "").slice(0, 4000),
    }));
}

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would start sequence "${p.sequence_template ?? "unknown"}" for ${p.lead_filter ?? "all hot leads"}.`,
      sequence_template: p.sequence_template,
      total_emails: p.total_emails,
      cadence_days: p.cadence_days,
    },
    error: "Email sends are gated — Phase 6.2.d will require explicit per-workspace opt-in.",
  };
}

export async function live(ctx: StepContext, step: PlanStep): Promise<StepResult> {
  const { admin, userToken, workspaceId, goal, stepOutputs, supabaseUrl, geminiApiKey } = ctx;

  if (!await flagEnabled(admin, workspaceId, SEND_EMAIL_FLAG)) {
    return gatedSkip(step.kind, SEND_EMAIL_FLAG);
  }

  // Cron-resume path can't authenticate to start-email-sequence-run as a user.
  if (isServiceRoleToken(userToken)) {
    return {
      status: "skipped",
      output: { live: true, summary: "email_sequence step skipped on cron-resume path (requires user-initiated run for plan-limit checks)." },
      error: "Email sequences need a user-initiated run; trigger the goal from /portal/goals to send.",
    };
  }

  const p = step.params ?? {};
  const totalEmails = Math.max(1, Math.min(7, Number(p.total_emails ?? 3)));
  const cadenceDays = Math.max(1, Math.min(14, Number(p.cadence_days ?? 3)));
  const rawTemplate = String(p.sequence_template ?? "welcome").toLowerCase().replace(/[\s-]+/g, "_");
  const templateCategory = TEMPLATE_CATEGORY_MAP[rawTemplate] ?? "custom";
  const filterRaw = typeof p.lead_filter === "string" ? p.lead_filter : "workspace.hot";

  const { leads, source } = await resolveLeads(admin, workspaceId, filterRaw, stepOutputs);
  if (leads.length === 0) {
    return {
      status: "skipped",
      output: {
        live: true,
        summary: `No leads matched filter "${filterRaw}". Resolved as: ${source}. Add leads or run upstream prospecting first.`,
        lead_filter: filterRaw,
        resolved_source: source,
        total_emails: totalEmails,
        cadence_days: cadenceDays,
      },
      error: `No leads matched lead_filter="${filterRaw}".`,
    };
  }

  let generated: GeneratedStep[];
  try {
    const sampleTitle = leads[0]?.title ?? "";
    const sampleIndustry = leads.find((l) => !!l.industry)?.industry ?? "";
    generated = await generateSequenceSteps(geminiApiKey, {
      totalEmails,
      cadenceDays,
      templateCategory,
      goalStatement: goal.statement,
      audienceHint: [sampleTitle, sampleIndustry, source].filter(Boolean).join(", "),
    });
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `Sequence generation failed: ${(e as Error).message}` };
  }

  const url = `${supabaseUrl}/functions/v1/start-email-sequence-run`;
  const payload = {
    leads: leads.map((l) => ({
      id:      l.id,
      email:   l.primary_email,
      name:    [l.first_name, l.last_name].filter(Boolean).join(" ") || l.primary_email,
      company: l.company ?? "",
      score:   l.score ?? undefined,
      status:  l.status ?? undefined,
      insights: l.insights ?? undefined,
      industry: l.industry ?? undefined,
      title:    l.title ?? undefined,
    })),
    steps: generated,
    config: {
      tone:             "professional",
      goal:             goal.statement,
      cadence:          `${cadenceDays}d`,
      templateCategory,
      sendMode:         "auto",
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${userToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        output: { live: true, summary: `start-email-sequence-run HTTP ${res.status}`, http_status: res.status },
        error: `start-email-sequence-run ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json() as { run_id: string; items_total: number };
    return {
      status: "succeeded",
      output: {
        live: true,
        summary: `Started ${totalEmails}-step "${templateCategory}" sequence for ${leads.length} lead(s). ${data.items_total} scheduled sends.`,
        run_id: data.run_id,
        items_total: data.items_total,
        leads_targeted: leads.length,
        template_category: templateCategory,
        cadence_days: cadenceDays,
        lead_filter_used: source,
      },
    };
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `email_sequence threw: ${(e as Error).message}` };
  }
}
