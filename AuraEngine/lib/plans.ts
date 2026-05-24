import { supabase } from './supabase';
import { CREDIT_LIMITS, getAiCreditLimit } from '../config/creditLimits';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlanLimits {
  credits: number;
  aiCredits: number;
  contacts: number;
  seats: number;
  emails: number;
  storage: number;
  maxInboxes: number;
  emailsPerDayPerInbox: number;
  emailsPerMonth: number;
  linkedInPerDay: number;
  linkedInPerMonth: number;
  /** @deprecated Use aiCredits instead */
  aiCreditsMonthly: number;
  hasAI: boolean;
}

export interface DbPlan {
  id: string;
  name: string;
  key: string | null;
  price: string;
  price_monthly_cents: number;
  currency: string;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
  credits: number;
  description: string | null;
  features: string[];
  is_active: boolean;
  limits: PlanLimits;
  sort_order: number;
  updated_at: string;
}

// ── Default limits (fallback when DB is unreachable) ─────────────────────────

const DEFAULT_LIMITS: Record<string, PlanLimits> = {
  Free: {
    credits: CREDIT_LIMITS.free, aiCredits: CREDIT_LIMITS.free, contacts: 5, seats: 1, emails: 5, storage: 200,
    maxInboxes: 1, emailsPerDayPerInbox: 5, emailsPerMonth: 5,
    linkedInPerDay: 5, linkedInPerMonth: 50, aiCreditsMonthly: CREDIT_LIMITS.free, hasAI: true,
  },
  Starter: {
    credits: CREDIT_LIMITS.starter, aiCredits: CREDIT_LIMITS.starter, contacts: 1000, seats: 1, emails: 2000, storage: 1000,
    maxInboxes: 1, emailsPerDayPerInbox: 40, emailsPerMonth: 1000,
    linkedInPerDay: 20, linkedInPerMonth: 600, aiCreditsMonthly: CREDIT_LIMITS.starter, hasAI: true,
  },
  Growth: {
    credits: CREDIT_LIMITS.growth, aiCredits: CREDIT_LIMITS.growth, contacts: 10000, seats: 3, emails: 15000, storage: 10000,
    maxInboxes: 5, emailsPerDayPerInbox: 60, emailsPerMonth: 10000,
    linkedInPerDay: 40, linkedInPerMonth: 1200, aiCreditsMonthly: CREDIT_LIMITS.growth, hasAI: true,
  },
  Scale: {
    credits: CREDIT_LIMITS.scale, aiCredits: CREDIT_LIMITS.scale, contacts: 50000, seats: 10, emails: 40000, storage: 50000,
    maxInboxes: 15, emailsPerDayPerInbox: 80, emailsPerMonth: 50000,
    linkedInPerDay: 100, linkedInPerMonth: 3000, aiCreditsMonthly: CREDIT_LIMITS.scale, hasAI: true,
  },
};

// ── In-memory cache (5 min TTL) ─────────────────────────────────────────────

let cachedPlans: DbPlan[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

function isCacheValid(): boolean {
  return cachedPlans !== null && Date.now() - cacheTs < CACHE_TTL;
}

/** Force-clear the plan cache (e.g. after admin edit). */
export function invalidatePlanCache(): void {
  cachedPlans = null;
  cacheTs = 0;
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Fetch all active plans, sorted by sort_order. Cached for 5 min. */
export async function getPlans(): Promise<DbPlan[]> {
  if (isCacheValid()) return cachedPlans!;

  // Try new schema first (is_active + sort_order columns)
  let { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  // Fallback: if new columns don't exist yet, use old query
  if (error) {
    const fallback = await supabase
      .from('plans')
      .select('*')
      .order('credits', { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data || data.length === 0) {
    console.warn('[plans] DB fetch failed, using defaults:', error?.message);
    return buildFallbackPlans();
  }

  // Ensure limits have all expected keys (merge with defaults)
  cachedPlans = data.map(normalizePlan);
  cacheTs = Date.now();
  return cachedPlans;
}

/** Fetch ALL plans (including inactive), for admin use. */
export async function getAllPlans(): Promise<DbPlan[]> {
  // Try new schema first (sort_order column)
  let { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true });

  // Fallback: if sort_order column doesn't exist yet, order by credits
  if (error) {
    const fallback = await supabase
      .from('plans')
      .select('*')
      .order('credits', { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data || data.length === 0) return buildFallbackPlans();
  return data.map(normalizePlan);
}

/** Get a plan by its key (e.g. 'starter', 'growth', 'scale'). */
export async function getPlanByKey(key: string): Promise<DbPlan | null> {
  const plans = await getPlans();
  return plans.find(p => p.key === key) ?? null;
}

/** Get a plan by its name (e.g. 'Starter', 'Growth', 'Scale'). */
export async function getPlanByName(planName: string): Promise<DbPlan | null> {
  const resolved = resolvePlanName(planName);
  const plans = await getPlans();
  return plans.find(p => p.name === resolved) ?? null;
}

/** Get plan limits by plan name (DB-driven, falls back to hardcoded). */
export async function getPlanLimits(planName: string): Promise<PlanLimits> {
  const plan = await getPlanByName(planName);
  if (plan) return plan.limits;
  const resolved = resolvePlanName(planName);
  return DEFAULT_LIMITS[resolved] ?? DEFAULT_LIMITS.Free;
}

/** Synchronous fallback for plan limits — uses hardcoded defaults only. */
export function getPlanLimitsSync(planName: string): PlanLimits {
  const resolved = resolvePlanName(planName);
  return DEFAULT_LIMITS[resolved] ?? DEFAULT_LIMITS.Free;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Canonical resolver for legacy plan-name aliases. Single source of truth —
 * all other modules import from here (lib/credits.ts re-exports for
 * back-compat; supabase/functions/_shared/plans.ts mirrors for Deno).
 */
export function resolvePlanName(name: string): string {
  if (name === 'Professional') return 'Growth';
  if (name === 'Enterprise' || name === 'Business') return 'Scale';
  return name;
}

function normalizePlan(raw: Record<string, unknown>): DbPlan {
  const name = (raw.name as string) || 'Unknown';
  const fallbackLimits = DEFAULT_LIMITS[name] ?? DEFAULT_LIMITS.Starter;
  const dbLimits = (raw.limits as Partial<PlanLimits>) || {};

  return {
    id: raw.id as string,
    name,
    key: (raw.key as string) ?? null,
    price: (raw.price as string) ?? '$0',
    price_monthly_cents: (raw.price_monthly_cents as number) ?? 0,
    currency: (raw.currency as string) ?? 'usd',
    stripe_price_id: (raw.stripe_price_id as string) ?? null,
    stripe_price_id_annual: (raw.stripe_price_id_annual as string) ?? null,
    credits: (raw.credits as number) ?? 0,
    description: (raw.description as string) ?? null,
    features: (raw.features as string[]) ?? [],
    is_active: (raw.is_active as boolean) ?? true,
    sort_order: (raw.sort_order as number) ?? 0,
    updated_at: (raw.updated_at as string) ?? new Date().toISOString(),
    limits: {
      credits:              dbLimits.credits ?? fallbackLimits.credits,
      aiCredits:            dbLimits.aiCredits ?? ((dbLimits as Record<string, unknown>).aiCreditsMonthly as number | undefined) ?? fallbackLimits.aiCredits,
      contacts:             dbLimits.contacts ?? fallbackLimits.contacts,
      seats:                dbLimits.seats ?? fallbackLimits.seats,
      emails:               dbLimits.emails ?? fallbackLimits.emails,
      storage:              dbLimits.storage ?? fallbackLimits.storage,
      maxInboxes:           dbLimits.maxInboxes ?? fallbackLimits.maxInboxes,
      emailsPerDayPerInbox: dbLimits.emailsPerDayPerInbox ?? fallbackLimits.emailsPerDayPerInbox,
      emailsPerMonth:       dbLimits.emailsPerMonth ?? fallbackLimits.emailsPerMonth,
      linkedInPerDay:       dbLimits.linkedInPerDay ?? fallbackLimits.linkedInPerDay,
      linkedInPerMonth:     dbLimits.linkedInPerMonth ?? fallbackLimits.linkedInPerMonth,
      aiCreditsMonthly:     dbLimits.aiCreditsMonthly ?? dbLimits.aiCredits ?? fallbackLimits.aiCreditsMonthly,
      hasAI:                dbLimits.hasAI ?? fallbackLimits.hasAI,
    },
  };
}

function buildFallbackPlans(): DbPlan[] {
  return ['Free', 'Starter', 'Growth', 'Scale'].map((name, i) => ({
    id: `fallback-${name.toLowerCase()}`,
    name,
    key: name.toLowerCase(),
    price: name === 'Free' ? 'Free' : name === 'Starter' ? '$29/mo' : name === 'Growth' ? '$79/mo' : '$199/mo',
    price_monthly_cents: name === 'Free' ? 0 : name === 'Starter' ? 2900 : name === 'Growth' ? 7900 : 19900,
    currency: 'usd',
    stripe_price_id: null,
    stripe_price_id_annual: null,
    credits: getAiCreditLimit(name),
    description: null,
    features: [],
    is_active: true,
    limits: DEFAULT_LIMITS[name],
    sort_order: i + 1,
    updated_at: new Date().toISOString(),
  }));
}
