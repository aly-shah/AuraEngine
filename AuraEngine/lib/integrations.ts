import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { getRequestId } from './requestId';
import type { Integration } from '../types';

// ─── Integration CRUD ───

export async function fetchIntegrations(): Promise<Integration[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch integrations:', error.message);
    return [];
  }

  return (data || []).map(row => ({
    id: row.id,
    provider: row.provider,
    category: row.category,
    status: row.status,
    credentials: row.credentials || {},
    metadata: row.metadata || {},
    updated_at: row.updated_at,
  }));
}

export async function fetchIntegration(provider: string): Promise<Integration | null> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('provider', provider)
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    provider: data.provider,
    category: data.category,
    status: data.status,
    credentials: data.credentials || {},
    metadata: data.metadata || {},
    updated_at: data.updated_at,
  };
}

export async function upsertIntegration(
  provider: string,
  category: string,
  credentials: Record<string, string>,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('integrations')
    .upsert({
      owner_id: user.id,
      provider,
      category,
      status: 'connected',
      credentials,
      metadata: { ...metadata, lastValidated: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,provider' });

  if (error) throw new Error(`Failed to save integration: ${error.message}`);
}

export async function disconnectIntegration(provider: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('integrations')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('owner_id', user.id)
    .eq('provider', provider);

  if (error) throw new Error(`Failed to disconnect integration: ${error.message}`);
}

// ─── Validation (calls edge function) ───

export async function validateIntegration(
  provider: string,
  credentials: Record<string, string>
): Promise<{ success: boolean; error?: string; details?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/validate-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ provider, credentials, request_id: getRequestId() }),
    });

    return await res.json();
  } catch (err) {
    return { success: false, error: `Network error: ${(err as Error).message}` };
  }
}

// ─── React Hook: useIntegrations ───

export interface IntegrationStatus {
  provider: string;
  category: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync?: string;
}

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nonEmail = await fetchIntegrations();

      const { data: emailData } = await supabase
        .from('email_provider_configs')
        .select('provider, is_active, updated_at');

      const emailStatuses: IntegrationStatus[] = (emailData || []).map((row: any) => ({
        provider: row.provider,
        category: 'email',
        status: row.is_active ? 'connected' as const : 'disconnected' as const,
        lastSync: row.updated_at,
      }));

      const nonEmailStatuses: IntegrationStatus[] = nonEmail.map(i => ({
        provider: i.provider,
        category: i.category,
        status: i.status,
        lastSync: i.updated_at,
      }));

      setIntegrations([...nonEmailStatuses, ...emailStatuses]);
    } catch (err) {
      console.error('useIntegrations load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { integrations, loading, refetch: load };
}
