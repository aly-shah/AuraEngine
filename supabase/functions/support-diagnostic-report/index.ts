// supabase/functions/support-diagnostic-report/index.ts
// Deploy: supabase functions deploy support-diagnostic-report
//
// Generates a comprehensive diagnostic JSON report for a target user.
// All credentials are masked. Requires an active support session.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function mask(value: string | null | undefined): string {
  if (!value) return '(empty)';
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}

function maskObject(obj: Record<string, unknown>, sensitiveKeys: string[]): Record<string, unknown> {
  const masked = { ...obj };
  for (const key of sensitiveKeys) {
    if (key in masked && typeof masked[key] === 'string') {
      masked[key] = mask(masked[key] as string);
    }
  }
  return masked;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Check is_super_admin
    const { data: profile } = await admin
      .from('profiles')
      .select('is_super_admin, role')
      .eq('id', caller.id)
      .single();

    if (!profile || profile.role !== 'ADMIN' || !profile.is_super_admin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check support_mode_enabled
    const { data: configRow } = await admin
      .from('config_settings')
      .select('value')
      .eq('key', 'support_mode_enabled')
      .single();

    if (!configRow || configRow.value !== 'true') {
      return new Response(JSON.stringify({ error: 'Support mode is disabled' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { target_user_id, sections } = body;

    if (!target_user_id) {
      return new Response(JSON.stringify({ error: 'Missing target_user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify active support session
    const { data: session } = await admin
      .from('support_sessions')
      .select('id')
      .eq('admin_id', caller.id)
      .eq('target_user_id', target_user_id)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .is('ended_at', null)
      .limit(1)
      .single();

    if (!session) {
      return new Response(JSON.stringify({ error: 'No active support session' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const selectedSections: string[] = sections || [
      'profile', 'subscription', 'integrations', 'email_configs',
      'webhooks', 'leads_summary', 'audit_logs',
    ];

    const report: Record<string, unknown> = {
      generated_at: new Date().toISOString(),
      generated_by: caller.id,
      target_user_id,
      session_id: session.id,
    };

    // Gather data in parallel
    const fetches: Promise<void>[] = [];

    if (selectedSections.includes('profile')) {
      fetches.push(
        admin.from('profiles').select('id, email, name, role, status, plan, credits_total, credits_used, created_at')
          .eq('id', target_user_id).single()
          .then(({ data }) => { report.profile = data; })
      );
    }

    if (selectedSections.includes('subscription')) {
      fetches.push(
        admin.from('subscriptions').select('*')
          .eq('user_id', target_user_id).order('created_at', { ascending: false }).limit(1).single()
          .then(({ data }) => { report.subscription = data; })
      );
    }

    if (selectedSections.includes('integrations')) {
      fetches.push(
        admin.from('integrations').select('*')
          .eq('owner_id', target_user_id)
          .then(({ data }) => {
            report.integrations = (data || []).map((i: Record<string, unknown>) =>
              maskObject(i, ['api_key', 'access_token', 'refresh_token', 'client_secret'])
            );
          })
      );
    }

    if (selectedSections.includes('email_configs')) {
      fetches.push(
        admin.from('email_provider_configs').select('*')
          .eq('owner_id', target_user_id)
          .then(({ data }) => {
            report.email_configs = (data || []).map((c: Record<string, unknown>) =>
              maskObject(c, ['api_key', 'smtp_pass', 'smtp_user'])
            );
          })
      );
    }

    if (selectedSections.includes('webhooks')) {
      fetches.push(
        admin.from('webhooks').select('*')
          .eq('owner_id', target_user_id)
          .then(({ data }) => {
            report.webhooks = (data || []).map((w: Record<string, unknown>) =>
              maskObject(w, ['secret'])
            );
          })
      );
    }

    if (selectedSections.includes('leads_summary')) {
      fetches.push(
        admin.from('leads').select('id, status, score, created_at')
          .eq('client_id', target_user_id)
          .then(({ data }) => {
            const leads = data || [];
            const byStatus: Record<string, number> = {};
            for (const l of leads) {
              byStatus[l.status] = (byStatus[l.status] || 0) + 1;
            }
            report.leads_summary = {
              total: leads.length,
              by_status: byStatus,
              avg_score: leads.length ? (leads.reduce((s: number, l: { score: number }) => s + (l.score || 0), 0) / leads.length).toFixed(1) : null,
            };
          })
      );
    }

    if (selectedSections.includes('audit_logs')) {
      fetches.push(
        admin.from('support_audit_logs').select('*')
          .eq('target_user_id', target_user_id)
          .order('created_at', { ascending: false })
          .limit(50)
          .then(({ data }) => { report.recent_audit_logs = data; })
      );
    }

    await Promise.all(fetches);

    // Audit log the export
    await admin.from('support_audit_logs').insert({
      session_id: session.id,
      admin_id: caller.id,
      target_user_id,
      action: 'export_diagnostic_report',
      resource_type: 'diagnostic_report',
      details: { sections: selectedSections },
    });

    return new Response(JSON.stringify({ ok: true, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
