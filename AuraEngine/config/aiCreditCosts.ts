// ── AI Credit Costs — Single Source of Truth ──────────────────────────────────
//
// Every AI operation deducts a fixed cost from the workspace's monthly credits.
// All AI feature code MUST reference this map instead of hardcoding numbers.
// ──────────────────────────────────────────────────────────────────────────────

export const AI_CREDIT_COSTS = {
  // Email & sequences
  email_generation: 2,
  email_sequence: 3,

  // Content
  content_generation: 2,
  content_suggestions: 1,
  blog_generation: 5,
  blog_content: 5, // alias for blog_generation (used by BlogDrafts)
  social_caption: 1,
  guest_post_pitch: 2,

  // Images
  image_generation: 3,

  // Intelligence
  lead_research: 2,
  lead_scoring: 1,
  business_analysis: 5,
  clear_business_profile: 2,
  profile_field_generation: 1,

  // Strategy & automation
  pipeline_strategy: 3,
  workflow_optimization: 2,
  command_center: 2,
  dashboard_insights: 1,

  // Batch
  batch_generation: 5,

  // Voice
  follow_up_questions: 1,
} as const;

export type AiOperation = keyof typeof AI_CREDIT_COSTS;

/** Get the credit cost for an AI operation. Throws if operation is unknown. */
export function getOperationCost(operation: string): number {
  const cost = AI_CREDIT_COSTS[operation as AiOperation];
  if (cost === undefined) {
    console.warn(`[aiCreditCosts] Unknown operation "${operation}", defaulting to 2 credits`);
    return 2;
  }
  return cost;
}

/** Estimate approximate usage counts for a given credit budget. */
export function estimateCreditUsage(credits: number) {
  return {
    personalizedEmails: Math.floor(credits / AI_CREDIT_COSTS.email_generation),
    leadResearchReports: Math.floor(credits / AI_CREDIT_COSTS.lead_research),
    blogArticles: Math.floor(credits / AI_CREDIT_COSTS.blog_generation),
    emailSequences: Math.floor(credits / AI_CREDIT_COSTS.email_sequence),
    imageGenerations: Math.floor(credits / AI_CREDIT_COSTS.image_generation),
  };
}
