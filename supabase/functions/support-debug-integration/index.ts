// supabase/functions/support-debug-integration/index.ts
// Deploy: supabase functions deploy support-debug-integration
//
// Tests a target user's integration credentials server-side,
// returning results with masked secrets. Requires an active support session.

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

    // Verify caller identity with anon client
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

    // Use service role for privileged queries
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
    const { target_user_id, integration_id, integration_type } = body;

    if (!target_user_id || !integration_type) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
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
      return new Response(JSON.stringify({ error: 'No active support session for this user' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let testResult: Record<string, unknown> = { status: 'unknown', type: integration_type };

    if (integration_type === 'email_smtp' || integration_type === 'email_sendgrid') {
      // Fetch email provider config
      const query = admin
        .from('email_provider_configs')
        .select('*')
        .eq('owner_id', target_user_id);

      if (integration_id) query.eq('id', integration_id);
      const { data: configs } = await query.limit(1).single();

      if (!configs) {
        testResult = { status: 'not_found', message: 'No email config found' };
      } else if (configs.provider === 'smtp') {
        testResult = {
          status: 'found',
          provider: 'smtp',
          host: configs.smtp_host,
          port: configs.smtp_port,
          username: mask(configs.smtp_user),
          password: mask(configs.smtp_pass),
          tls: configs.smtp_secure ?? true,
          message: 'SMTP config retrieved (credentials masked)',
        };
      } else if (configs.provider === 'sendgrid') {
        const apiKey = configs.api_key;
        testResult = {
          status: 'found',
          provider: 'sendgrid',
          api_key: mask(apiKey),
          message: 'SendGrid config retrieved (key masked)',
        };
        // Quick validation: hit SendGrid's scopes endpoint
        if (apiKey) {
          try {
            const sgRes = await fetch('https://api.sendgrid.com/v3/scopes', {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            testResult.api_valid = sgRes.ok;
            testResult.api_status = sgRes.status;
          } catch {
            testResult.api_valid = false;
            testResult.api_error = 'Connection failed';
          }
        }
      } else {
        testResult = {
          status: 'found',
          provider: configs.provider,
          message: `Provider ${configs.provider} config found`,
        };
      }
    } else {
      // Generic integration from integrations table
      const query = admin
        .from('integrations')
        .select('*')
        .eq('owner_id', target_user_id);

      if (integration_id) query.eq('id', integration_id);
      else query.eq('type', integration_type);

      const { data: integration } = await query.limit(1).single();

      if (!integration) {
        testResult = { status: 'not_found', message: `No ${integration_type} integration found` };
      } else {
        testResult = {
          status: 'found',
          type: integration.type,
          provider: integration.provider,
          connected: integration.is_connected,
          api_key: mask(integration.api_key),
          last_sync: integration.last_synced_at,
          message: `${integration_type} integration found`,
        };
      }
    }

    // Audit log
    await admin.from('support_audit_logs').insert({
      session_id: session.id,
      admin_id: caller.id,
      target_user_id,
      action: 'debug_integration',
      resource_type: integration_type,
      resource_id: integration_id || null,
      details: { result_status: testResult.status },
    });

    return new Response(JSON.stringify({ ok: true, result: testResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
