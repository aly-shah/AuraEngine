// AuraEngine/lib/branding.ts
//
// Phase 4.6.a — workspace branding loader + CSS-variable injector.
//
// Reads the workspace_branding row for the current user's workspace
// (resolved via workspace_members) and applies any non-null overrides
// as CSS variables on document.documentElement. Tailwind classes can
// reference these via arbitrary value syntax, e.g.
//   bg-[color:var(--brand-primary,#6366f1)]
//
// Variables set:
//   --brand-primary
//   --brand-accent
//   --brand-bg
//
// Logo URLs and copy are returned as plain values so React components
// can read them directly via useBranding().

import { supabase } from './supabase';

export interface WorkspaceBranding {
  workspace_id:     string;
  logo_url:         string | null;
  favicon_url:      string | null;
  email_logo_url:   string | null;
  primary_color:    string | null;
  accent_color:     string | null;
  background_color: string | null;
  product_name:     string | null;
  support_email:    string | null;
  updated_at:       string;
}

const _cache = new Map<string, WorkspaceBranding | null>();
const _hostCache = new Map<string, Partial<WorkspaceBranding> | null>();

/** Hostnames where vanity branding is never applied (the platform's own domains). */
const PLATFORM_HOSTS = new Set([
  'scaliyo.com',
  'www.scaliyo.com',
  'app.scaliyo.com',
  'localhost',
  '127.0.0.1',
]);

export async function loadBranding(userId: string): Promise<WorkspaceBranding | null> {
  if (_cache.has(userId)) return _cache.get(userId) ?? null;

  const { data: wm } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const workspaceId = wm?.workspace_id as string | undefined;
  if (!workspaceId) {
    _cache.set(userId, null);
    return null;
  }

  const { data, error } = await supabase
    .from('workspace_branding')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) {
    _cache.set(userId, null);
    return null;
  }

  const branding = (data as WorkspaceBranding | null) ?? null;
  _cache.set(userId, branding);
  return branding;
}

/**
 * Phase 4.6.b — pre-login branding lookup by hostname. Calls the
 * `get_branding_by_domain` RPC which is anon-grant'd and only returns
 * for vanity domains that are verified AND TLS-provisioned. Returns
 * null on platform hosts (scaliyo.com, app.scaliyo.com, localhost) so
 * the SPA stays on platform-default branding there.
 */
export async function loadBrandingByHost(host: string): Promise<Partial<WorkspaceBranding> | null> {
  const h = host.toLowerCase().split(':')[0]; // strip port
  if (PLATFORM_HOSTS.has(h)) return null;
  if (_hostCache.has(h)) return _hostCache.get(h) ?? null;

  try {
    const { data, error } = await supabase.rpc('get_branding_by_domain', { p_domain: h });
    if (error) {
      _hostCache.set(h, null);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const branding: Partial<WorkspaceBranding> | null = row
      ? {
          logo_url:         row.logo_url        ?? null,
          favicon_url:      row.favicon_url     ?? null,
          primary_color:    row.primary_color   ?? null,
          accent_color:     row.accent_color    ?? null,
          background_color: row.background_color?? null,
          product_name:     row.product_name    ?? null,
          support_email:    row.support_email   ?? null,
        }
      : null;
    _hostCache.set(h, branding);
    return branding;
  } catch {
    _hostCache.set(h, null);
    return null;
  }
}

export function applyBrandingToDocument(b: Partial<WorkspaceBranding> | null): void {
  const root = document.documentElement;
  // Always reset first so a removed override actually clears.
  root.style.removeProperty('--brand-primary');
  root.style.removeProperty('--brand-accent');
  root.style.removeProperty('--brand-bg');
  if (!b) return;
  if (b.primary_color)    root.style.setProperty('--brand-primary', b.primary_color);
  if (b.accent_color)     root.style.setProperty('--brand-accent',  b.accent_color);
  if (b.background_color) root.style.setProperty('--brand-bg',      b.background_color);

  if (b.favicon_url) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = b.favicon_url;
  }

  if (b.product_name) {
    document.title = `${b.product_name}`;
  }
}

export async function upsertBranding(
  workspaceId: string,
  patch: Partial<Omit<WorkspaceBranding, 'workspace_id' | 'updated_at'>>,
): Promise<WorkspaceBranding> {
  const { data, error } = await supabase
    .from('workspace_branding')
    .upsert({ workspace_id: workspaceId, ...patch }, { onConflict: 'workspace_id' })
    .select()
    .single();
  if (error) throw error;
  // Invalidate cache for this workspace's members on next reload.
  _cache.clear();
  return data as WorkspaceBranding;
}
