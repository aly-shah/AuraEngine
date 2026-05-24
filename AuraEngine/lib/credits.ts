import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_CREDIT_COSTS, getOperationCost } from '../config/aiCreditCosts';
import { CREDIT_LIMITS, getAiCreditLimit } from '../config/creditLimits';

// ── Credit costs per AI operation (re-exported from config) ──
export const CREDIT_COSTS = AI_CREDIT_COSTS;

// ── Tier limits (reads AI credits from config/creditLimits.ts) ────────────
export const TIER_LIMITS: Record<string, { credits: number; aiCredits: number; contacts: number; seats: number; emails: number; storage: number }> = {
  Free:     { credits: CREDIT_LIMITS.free,    aiCredits: CREDIT_LIMITS.free,    contacts: 5,     seats: 1,  emails: 5,     storage: 200   },
  Starter:  { credits: CREDIT_LIMITS.starter, aiCredits: CREDIT_LIMITS.starter, contacts: 1000,  seats: 1,  emails: 2000,  storage: 1000  },
  Growth:   { credits: CREDIT_LIMITS.growth,  aiCredits: CREDIT_LIMITS.growth,  contacts: 10000, seats: 3,  emails: 15000, storage: 10000 },
  Scale:    { credits: CREDIT_LIMITS.scale,   aiCredits: CREDIT_LIMITS.scale,   contacts: 50000, seats: 10, emails: 40000, storage: 50000 },
};

// ── Backward-compat plan name resolver ─────────────────────────────────────
// Canonical implementation lives in lib/plans.ts; re-exported here so the
// many existing callsites that import from './credits' don't have to move.
export { resolvePlanName } from './plans';
import { resolvePlanName } from './plans';

export function getPlanByName(name: string): PlanPackage | undefined {
  return PLANS.find(p => p.name === resolvePlanName(name));
}

export const ANNUAL_DISCOUNT = 0.15;

// ── Plan packages (single source of truth) ───────────────────────────────
export interface PlanPackage {
  name: string;
  price: number;
  annualPrice: number;
  credits: number;
  aiCredits: number;
  contacts: number;
  seats: number;
  emails: number;
  storage: number;
  features: string[];
  desc: string;
  popular?: boolean;
  cta: string;
  overage: { credits: number; contacts: number; emails: number };
  maxUsers?: number;
  extraSeatPrice?: number;
  warmup?: string;
}

export const PLANS: PlanPackage[] = [
  {
    name: 'Free',
    price: 0,
    annualPrice: 0,
    ...TIER_LIMITS.Free,
    desc: 'Try Scaliyo free. See what AI-powered outbound can do.',
    cta: 'Start Free',
    overage: { credits: 0, contacts: 0, emails: 0 },
    features: ['Manual warm-up guidance', 'Basic automation', 'Email + LinkedIn sequences', 'Deliverability protection'],
    maxUsers: 1,
    extraSeatPrice: 0,
    warmup: 'Guidance',
  },
  {
    name: 'Starter',
    price: 29,
    annualPrice: Math.round(29 * 12 * (1 - ANNUAL_DISCOUNT) / 12),
    ...TIER_LIMITS.Starter,
    desc: 'Your first outbound engine. One inbox. Real pipeline.',
    cta: `Start With ${CREDIT_LIMITS.starter.toLocaleString()} AI Credits`,
    overage: { credits: 0.08, contacts: 0.05, emails: 0.02 },
    features: ['Manual warm-up guidance', 'Basic automation', 'Email + LinkedIn sequences', 'Deliverability protection'],
    maxUsers: 3,
    extraSeatPrice: 15,
    warmup: 'Guidance',
  },
  {
    name: 'Growth',
    price: 79,
    annualPrice: Math.round(79 * 12 * (1 - ANNUAL_DISCOUNT) / 12),
    ...TIER_LIMITS.Growth,
    desc: 'The engine most teams actually need. Built to scale.',
    popular: true,
    cta: `Get ${CREDIT_LIMITS.growth.toLocaleString()} AI Credits`,
    overage: { credits: 0.06, contacts: 0.03, emails: 0.015 },
    features: ['Automated warm-up + ramp schedule', 'AI drafts, rewrites & personalization', 'Advanced automation & analytics', 'Enrichment', 'Everything in Starter'],
    maxUsers: 10,
    extraSeatPrice: 12,
    warmup: 'Automated',
  },
  {
    name: 'Scale',
    price: 199,
    annualPrice: Math.round(199 * 12 * (1 - ANNUAL_DISCOUNT) / 12),
    ...TIER_LIMITS.Scale,
    desc: 'Full outbound infrastructure. Maximum volume. Maximum intelligence.',
    cta: `Unlock ${CREDIT_LIMITS.scale.toLocaleString()} AI Credits`,
    overage: { credits: 0.04, contacts: 0.02, emails: 0.01 },
    features: ['Advanced AI personalization', 'Advanced warm-up + inbox health monitoring', 'API & Webhooks', 'Flexible team seats', 'Everything in Growth'],
    maxUsers: undefined,
    extraSeatPrice: 8,
    warmup: 'Advanced + Health',
  },
];

// ── Workspace resolution ────────────────────────────────────────────────────
// MVP assumption: one workspace per user. If this ever changes, accept an
// explicit workspaceId argument from callers (via a workspace context).
async function resolveWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[resolveWorkspaceId] lookup failed:', error.message);
    return null;
  }
  return data?.workspace_id ?? null;
}

// ── Helper: consume credits for an AI operation ─────────────────────────────
//
// Uses the workspace_ai_usage table + increment_ai_usage RPC.
// Resolves the real workspace id from workspace_members — previous versions
// passed user.id directly, which only worked while the ai_credit_usage /
// workspace_ai_usage FKs incorrectly pointed at profiles(id). Coordinated
// with migration 20260413100000_credit_system_fk_fix.sql.
//
export async function consumeCredits(
  supabase: SupabaseClient,
  operation: string,
): Promise<{ success: boolean; message: string }> {
  const cost = getOperationCost(operation);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: 'Not authenticated' };

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return {
      success: false,
      message: 'No workspace found for this account. Contact support if this persists.',
    };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single();
  const planName = resolvePlanName(profile?.plan || 'Free');
  const limit = getAiCreditLimit(planName);

  const month = new Date().toISOString().slice(0, 7);
  const { data: usageRow } = await supabase
    .from('workspace_ai_usage')
    .select('credits_used')
    .eq('workspace_id', workspaceId)
    .eq('month_year', month)
    .maybeSingle();

  const used = usageRow?.credits_used ?? 0;
  const remaining = Math.max(limit - used, 0);

  if (remaining < cost) {
    return {
      success: false,
      message: `Insufficient AI credits (${remaining} remaining, ${cost} needed). Upgrade your plan for more capacity.`,
    };
  }

  const { error: rpcErr } = await supabase.rpc('increment_ai_usage', {
    p_workspace_id: workspaceId,
    p_month_year: month,
    p_credits: cost,
    p_tokens: 0,
    p_credits_limit: limit,
  });

  if (rpcErr) return { success: false, message: rpcErr.message };

  supabase.from('ai_credit_usage').insert({
    workspace_id: workspaceId,
    operation,
    credits_used: cost,
  }).then(({ error }) => {
    if (error) console.warn('[consumeCredits] usage log failed:', error.message);
  });

  return { success: true, message: `${cost} credits deducted` };
}
