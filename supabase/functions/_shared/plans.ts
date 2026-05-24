// supabase/functions/_shared/plans.ts
//
// Deno-side mirror of lib/plans.ts's plan-name resolver + per-plan caps.
// Keep this in sync with AuraEngine/lib/plans.ts (DEFAULT_LIMITS) and
// AuraEngine/lib/credits.ts (TIER_LIMITS) — these are the legacy aliases
// we need to recognise when reading profiles.plan that was last written
// before the Professional → Growth / Enterprise|Business → Scale rename.

export function resolvePlanName(name: string | null | undefined): string {
  if (!name) return "Starter";
  if (name === "Professional") return "Growth";
  if (name === "Enterprise" || name === "Business") return "Scale";
  return name;
}

/** Monthly outbound-email caps per plan. Mirrors lib/plans.ts DEFAULT_LIMITS.emailsPerMonth. */
export const MONTHLY_EMAIL_LIMITS: Record<string, number> = {
  Free: 5,
  Starter: 1000,
  Growth: 10000,
  Scale: 50000,
};

export function getMonthlyEmailLimit(planName: string | null | undefined): number {
  return MONTHLY_EMAIL_LIMITS[resolvePlanName(planName)] ?? MONTHLY_EMAIL_LIMITS.Starter;
}
