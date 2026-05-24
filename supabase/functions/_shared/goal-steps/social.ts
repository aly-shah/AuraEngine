// supabase/functions/_shared/goal-steps/social.ts
//
// social_post: resolves the connected social account for the target channel,
// AI-generates a post body, and POSTs to social-post-now. Gated on
// goal_executor_send_social.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceRoleToken } from "../auth.ts";
import { geminiGenerate } from "./gemini.ts";
import { flagEnabled, gatedSkip, SEND_SOCIAL_FLAG } from "./flags.ts";
import type { PlanStep, StepContext, StepResult } from "./types.ts";

export const kind = "social_post";

interface SocialTarget { channel: string; target_id: string; target_label: string | null; }

async function resolveSocialTarget(
  admin: ReturnType<typeof createClient>,
  userId: string,
  plannerChannel: string,
): Promise<{ target: SocialTarget | null; reason: string }> {
  const ch = plannerChannel.toLowerCase().trim();
  const { data: accounts } = await admin
    .from("social_accounts")
    .select("provider, meta_page_id, meta_page_name, meta_ig_user_id, meta_ig_username, linkedin_member_urn, linkedin_org_urn, linkedin_org_name")
    .eq("user_id", userId);
  const list = accounts ?? [];

  if (ch === "twitter" || ch === "x") {
    return { target: null, reason: "Twitter/X publishing is not yet implemented in this workspace." };
  }
  if (ch === "linkedin") {
    const org = list.find((a) => a.linkedin_org_urn);
    if (org) return { target: { channel: "linkedin_org", target_id: org.linkedin_org_urn as string, target_label: (org.linkedin_org_name as string) ?? null }, reason: "linkedin_org" };
    const member = list.find((a) => a.linkedin_member_urn);
    if (member) return { target: { channel: "linkedin_member", target_id: member.linkedin_member_urn as string, target_label: null }, reason: "linkedin_member" };
    return { target: null, reason: "No connected LinkedIn account. Connect one in Integrations first." };
  }
  if (ch === "meta" || ch === "facebook") {
    const fb = list.find((a) => a.meta_page_id);
    if (fb) return { target: { channel: "facebook_page", target_id: fb.meta_page_id as string, target_label: (fb.meta_page_name as string) ?? null }, reason: "facebook_page" };
    return { target: null, reason: "No connected Facebook Page. Connect one in Integrations first." };
  }
  if (ch === "instagram") {
    const ig = list.find((a) => a.meta_ig_user_id);
    if (ig) return { target: { channel: "instagram", target_id: ig.meta_ig_user_id as string, target_label: (ig.meta_ig_username as string) ?? null }, reason: "instagram" };
    return { target: null, reason: "No connected Instagram account. Connect one in Integrations first." };
  }
  return { target: null, reason: `Unknown channel "${plannerChannel}".` };
}

const CHANNEL_COPY_CONSTRAINTS: Record<string, string> = {
  linkedin_org:    "LinkedIn organization post. 800-1200 chars. 2-3 short paragraphs, no hashtags spam — at most 3 relevant hashtags at the end. No emojis.",
  linkedin_member: "LinkedIn personal post. 600-1000 chars. Conversational, first-person, 2-3 paragraphs. At most 3 hashtags. No emojis.",
  facebook_page:   "Facebook Page post. 400-800 chars. Friendly, includes a clear CTA at the end.",
  instagram:       "Instagram caption. Under 500 chars. Catchy first line, then context, then 4-7 trailing hashtags on a new line.",
};

async function generateSocialCopy(
  geminiApiKey: string,
  channel: string,
  topic: string,
  goalStatement: string,
): Promise<string> {
  const constraint = CHANNEL_COPY_CONSTRAINTS[channel] ?? "Concise social post under 800 chars.";
  const system = "You write high-engagement B2B social copy. Output ONLY the post body — no preamble, no commentary, no quotes around the post.";
  const prompt = `Write one ${channel.replace("_", " ")} post about: "${topic}".
Broader goal this post serves: ${goalStatement}.

Channel constraints: ${constraint}

Output: the post body, nothing else.`;
  const { text } = await geminiGenerate(geminiApiKey, prompt, system);
  return text.trim().replace(/^["']|["']$/g, "");
}

export function dryRun(step: PlanStep): StepResult {
  const p = step.params ?? {};
  return {
    status: "succeeded",
    output: {
      dry_run: true,
      summary: `Would publish a ${p.channel ?? "social"} post on the topic: "${p.topic ?? ""}".`,
      channel: p.channel,
      topic: p.topic,
    },
    error: "Social publishes are gated — Phase 6.2.d will require explicit per-workspace opt-in.",
  };
}

export async function live(ctx: StepContext, step: PlanStep): Promise<StepResult> {
  const { admin, userToken, userId, workspaceId, goal, supabaseUrl, geminiApiKey } = ctx;

  if (!await flagEnabled(admin, workspaceId, SEND_SOCIAL_FLAG)) {
    return gatedSkip(step.kind, SEND_SOCIAL_FLAG);
  }
  if (isServiceRoleToken(userToken)) {
    return {
      status: "skipped",
      output: { live: true, summary: "social_post step skipped on cron-resume path (requires user-initiated run for publish auth)." },
      error: "Social posts need a user-initiated run; trigger the goal from /portal/goals.",
    };
  }

  const p = step.params ?? {};
  const plannerChannel = String(p.channel ?? "linkedin");
  const topic = String(p.topic ?? step.title ?? "").trim();
  if (!topic) {
    return { status: "failed", output: { live: true }, error: "social_post requires params.topic." };
  }

  const { target, reason } = await resolveSocialTarget(admin, userId, plannerChannel);
  if (!target) {
    return {
      status: "skipped",
      output: { live: true, summary: `Cannot publish ${plannerChannel}: ${reason}`, planner_channel: plannerChannel },
      error: reason,
    };
  }

  let copy: string;
  try {
    copy = await generateSocialCopy(geminiApiKey, target.channel, topic, goal.statement);
    if (!copy) throw new Error("empty copy");
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `Copy generation failed: ${(e as Error).message}` };
  }

  const url = `${supabaseUrl}/functions/v1/social-post-now`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        content_text: copy,
        targets: [target],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        status: "failed",
        output: { live: true, summary: `social-post-now HTTP ${res.status}`, channel: target.channel, copy_preview: copy.slice(0, 200) },
        error: `social-post-now ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const tgts = (data?.targets ?? []) as Array<{ status?: string; error?: string }>;
    const anyFailed = tgts.some((t) => t.status === "failed" || t.error);
    return {
      status: anyFailed ? "failed" : "succeeded",
      output: {
        live: true,
        summary: anyFailed
          ? `Posted to ${target.channel}, but at least one target reported an error.`
          : `Published to ${target.channel}${target.target_label ? ` (${target.target_label})` : ""}.`,
        channel: target.channel,
        target_label: target.target_label,
        copy_length: copy.length,
        post_id: (data as { id?: string }).id ?? null,
        per_target: tgts,
      },
      error: anyFailed ? "One or more target publishes failed — see per_target." : undefined,
    };
  } catch (e) {
    return { status: "failed", output: { live: true }, error: `social_post threw: ${(e as Error).message}` };
  }
}
