import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { getMonthlyEmailLimit, resolvePlanName } from "../_shared/plans.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

interface LeadInput {
  id: string;
  email: string;
  name: string;
  company: string;
  score?: number;
  status?: string;
  insights?: string;
  knowledgeBase?: Record<string, unknown>;
  industry?: string;
  title?: string;
}

interface StepInput {
  stepIndex: number;
  delayDays: number;
  subject: string;
  body: string;
}

interface ConfigInput {
  tone: string;
  goal: string;
  cadence?: string;
  templateCategory?: string;
  fromEmail?: string;
  fromName?: string;
  provider?: string;
  businessProfile?: Record<string, unknown>;
  sendMode?: string;
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;
  const corsHeaders = getCorsHeaders(req);

  try {
    // Authenticate the user via JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseUser.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const leads: LeadInput[] = body.leads;
    const steps: StepInput[] = body.steps;
    const config: ConfigInput = body.config;

    if (!leads?.length || !steps?.length) {
      return new Response(
        JSON.stringify({ error: "leads and steps are required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const totalItems = leads.length * steps.length;

    // Pre-flight: check monthly usage limit via workspace_usage_counters
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const { data: usageData } = await supabaseAdmin.rpc(
      "get_workspace_monthly_usage",
      {
        p_workspace_id: user.id,
        p_month_key: monthKey,
      }
    );
    const currentUsage = Number(
      (Array.isArray(usageData) ? usageData[0] : usageData)
        ?.total_emails_sent ?? 0
    );

    // Fetch user's plan and resolve limits
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .single();

    const resolvedPlan = resolvePlanName(profile?.plan);
    const limit = getMonthlyEmailLimit(resolvedPlan);

    if (currentUsage + totalItems > limit) {
      return new Response(
        JSON.stringify({
          error: `Monthly email limit would be exceeded. Current: ${currentUsage}, Requested: ${totalItems}, Limit: ${limit}`,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert run
    const { data: run, error: runError } = await supabaseAdmin
      .from("email_sequence_runs")
      .insert({
        owner_id: user.id,
        status: "processing",
        lead_count: leads.length,
        step_count: steps.length,
        items_total: totalItems,
        items_done: 0,
        items_failed: 0,
        sequence_config: {
          tone: config.tone,
          goal: config.goal,
          cadence: config.cadence,
          templateCategory: config.templateCategory,
          from_email: config.fromEmail,
          from_name: config.fromName,
          provider: config.provider,
          businessProfile: config.businessProfile,
          sendMode: config.sendMode,
        },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runError || !run) {
      throw new Error(`Failed to create run: ${runError?.message}`);
    }

    // Batch-insert all items (lead × step)
    const items = [];
    for (const lead of leads) {
      for (const step of steps) {
        items.push({
          run_id: run.id,
          lead_id: lead.id,
          step_index: step.stepIndex,
          status: "pending",
          lead_email: lead.email,
          lead_name: lead.name || "",
          lead_company: lead.company || "",
          lead_context: {
            score: lead.score,
            status: lead.status,
            insights: lead.insights,
            knowledgeBase: lead.knowledgeBase,
            industry: lead.industry,
            title: lead.title,
          },
          template_subject: step.subject,
          template_body: step.body,
          delay_days: step.delayDays,
          attempt_count: 0,
        });
      }
    }

    // Insert in chunks of 500 to avoid payload limits
    const chunkSize = 500;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const { error: insertError } = await supabaseAdmin
        .from("email_sequence_run_items")
        .insert(chunk);

      if (insertError) {
        // Clean up the run on failure
        await supabaseAdmin
          .from("email_sequence_runs")
          .update({ status: "failed", error_summary: insertError.message })
          .eq("id", run.id);
        throw new Error(`Failed to insert items: ${insertError.message}`);
      }
    }

    return new Response(
      JSON.stringify({ run_id: run.id, items_total: totalItems }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("start-email-sequence-run error:", err);
    return new Response(
      JSON.stringify({ error: `Internal error: ${(err as Error).message}` }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
