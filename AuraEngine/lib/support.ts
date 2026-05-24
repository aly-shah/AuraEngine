import { supabase } from './supabase';
import { logSupportAction } from './supportAudit';

// ── Types ────────────────────────────────────────────────────

export interface SupportSession {
  id: string;
  admin_id: string;
  target_user_id: string;
  reason: string;
  access_level: 'read_only' | 'debug';
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface TargetProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
  credits_total: number;
  credits_used: number;
  created_at: string;
}

// ── Session management ───────────────────────────────────────

export async function startSupportSession(
  adminId: string,
  targetUserId: string,
  reason: string,
  accessLevel: 'read_only' | 'debug' = 'read_only',
): Promise<SupportSession> {
  const { data, error } = await supabase
    .from('support_sessions')
    .insert({
      admin_id: adminId,
      target_user_id: targetUserId,
      reason,
      access_level: accessLevel,
    })
    .select()
    .single();

  if (error) throw error;

  await logSupportAction({
    session_id: data.id,
    admin_id: adminId,
    target_user_id: targetUserId,
    action: 'start_session',
    details: { reason, access_level: accessLevel },
  });

  return data as SupportSession;
}

export async function endSupportSession(sessionId: string, adminId: string, targetUserId: string): Promise<void> {
  const { error } = await supabase
    .from('support_sessions')
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;

  await logSupportAction({
    session_id: sessionId,
    admin_id: adminId,
    target_user_id: targetUserId,
    action: 'end_session',
  });
}

export async function getActiveSession(adminId: string): Promise<SupportSession | null> {
  const { data } = await supabase
    .from('support_sessions')
    .select('*')
    .eq('admin_id', adminId)
    .eq('is_active', true)
    .gt('expires_at', new Date().toISOString())
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as SupportSession) ?? null;
}

export async function getSessionHistory(adminId: string, limit = 50): Promise<SupportSession[]> {
  const { data } = await supabase
    .from('support_sessions')
    .select('*')
    .eq('admin_id', adminId)
    .order('started_at', { ascending: false })
    .limit(limit);

  return (data ?? []) as SupportSession[];
}

// ── Target user data fetching ────────────────────────────────

export async function searchUsers(query: string): Promise<TargetProfile[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, name, role, status, plan, credits_total, credits_used, created_at')
    .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
    .order('created_at', { ascending: false })
    .limit(25);

  return (data ?? []) as TargetProfile[];
}

export async function getTargetProfile(userId: string): Promise<TargetProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, name, role, status, plan, credits_total, credits_used, created_at')
    .eq('id', userId)
    .single();

  return (data as TargetProfile) ?? null;
}

export async function getTargetIntegrations(userId: string) {
  const { data } = await supabase
    .from('integrations')
    .select('*')
    .eq('owner_id', userId);
  return data ?? [];
}

export async function getTargetEmailConfigs(userId: string) {
  const { data } = await supabase
    .from('email_provider_configs')
    .select('*')
    .eq('owner_id', userId);
  return data ?? [];
}

export async function getTargetWebhooks(userId: string) {
  // The legacy `webhooks` table was retired; outbound webhooks now live in
  // `webhook_endpoints` (workspace-scoped). For support's purposes we treat
  // the user's own id as the workspace id (auto-created workspaces share
  // the user's UUID; manual workspaces won't appear here, but support can
  // pivot to the workspace_id directly if needed).
  const { data } = await supabase
    .from('webhook_endpoints')
    .select('id, url, description, event_types, enabled, failure_count, last_attempt_at, last_success_at, created_at')
    .eq('workspace_id', userId);
  return data ?? [];
}

export async function getTargetLeads(userId: string, limit = 100) {
  const { data } = await supabase
    .from('leads')
    .select('id, first_name, last_name, primary_email, company, status, score, created_at')
    .eq('client_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getTargetSubscription(userId: string) {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function getTargetEmailMessages(userId: string, limit = 50) {
  const { data } = await supabase
    .from('email_messages')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ── Audit logs ───────────────────────────────────────────────

export async function getAuditLogs(targetUserId?: string, limit = 100) {
  let query = supabase
    .from('support_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (targetUserId) {
    query = query.eq('target_user_id', targetUserId);
  }

  const { data } = await query;
  return data ?? [];
}

// ── Edge function calls ──────────────────────────────────────

export async function debugIntegration(
  targetUserId: string,
  integrationType: string,
  integrationId?: string,
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await supabase.functions.invoke('support-debug-integration', {
    body: {
      target_user_id: targetUserId,
      integration_type: integrationType,
      integration_id: integrationId,
    },
  });

  if (res.error) throw res.error;
  return res.data;
}

export async function exportDiagnosticReport(
  targetUserId: string,
  sections?: string[],
) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await supabase.functions.invoke('support-diagnostic-report', {
    body: {
      target_user_id: targetUserId,
      sections,
    },
  });

  if (res.error) throw res.error;
  return res.data;
}

// ── Download helper ──────────────────────────────────────────

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
