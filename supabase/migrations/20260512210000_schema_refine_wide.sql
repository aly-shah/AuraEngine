-- ============================================================================
-- 20260512210000_schema_refine_wide.sql
-- ----------------------------------------------------------------------------
-- Wide schema refinement after the live-DB audit (2026-05-12).
--
-- Three buckets, all mechanical / safe:
--
--   1. SECURITY DEFINER hardening — 18 pre-existing SECURITY DEFINER
--      functions missing `SET search_path`. Without that, a tenant with
--      CREATE on any schema in their search_path can shadow a built-in
--      and hijack the function's execution. Setting search_path to
--      `public, pg_temp` is the canonical Supabase pattern.
--
--   2. FK indexes — 11 foreign-key columns on warm tables that lack a
--      covering index. Cold-path FKs (created_by / updated_by / invited_by
--      audit columns across 25 tables) are intentionally skipped — index
--      maintenance cost outweighs the rare-join benefit.
--
--   3. Redundant indexes — 16 single-column indexes covered by the
--      leftmost prefix of a composite index that already exists. Postgres'
--      planner will use the composite for the prefix queries, so the
--      single-column index is pure write overhead + disk.
--
-- Documentation: api_idempotency table comment to record the
-- service-role-only-write intent (RLS enabled + zero policies is
-- deliberate; without the comment future maintainers misread it as a bug).
--
-- Three items deferred to explicit user confirmation (NOT in this migration):
--   - drop "Public Profiles View" anon-readable policy on profiles
--   - NOT NULL on 4 workspace_id columns (needs backfill verification)
--   - drop profiles.createdAt camelCase duplicate (needs app-reader audit)
-- ============================================================================

-- ── 1. SECURITY DEFINER search_path hardening ──────────────────────────
--
-- Use a DO block + format() so we don't need to enumerate each function's
-- arg-signature by hand. Only touches SECURITY DEFINER functions whose
-- proconfig is null or doesn't already set search_path.

do $$
declare
  fn record;
  target_names text[] := array[
    'check_email_exists',
    'connect_sender_account',
    'consume_credits',
    'get_category_post_counts',
    'get_sender_daily_sent',
    'get_workspace_daily_usage',
    'get_workspace_monthly_usage',
    'increment_ai_usage',
    'increment_outbound_usage',
    'increment_sender_daily_sent',
    'increment_usage',
    'increment_workspace_usage',
    'teamhub_check_lead_link_scope',
    'teamhub_mirror_activity_to_audit',
    'teamhub_sync_lead_on_move',
    'teamhub_user_flow_role'
  ];
begin
  for fn in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef = true
       and p.proname = any(target_names)
       and not exists (
         select 1
         from unnest(coalesce(p.proconfig, array[]::text[])) c
         where c like 'search_path=%'
       )
  loop
    raise notice 'hardening search_path on %', fn.sig;
    execute format('alter function %s set search_path = public, pg_temp', fn.sig);
  end loop;
end $$;

-- ── 2. FK indexes ──────────────────────────────────────────────────────

create index if not exists idx_tags_workspace
  on public.tags (workspace_id);

create index if not exists idx_workspace_invites_workspace
  on public.workspace_invites (workspace_id);

create index if not exists idx_leads_assigned_to
  on public.leads (assigned_to)
  where assigned_to is not null;

create index if not exists idx_sequence_enrollments_lead
  on public.sequence_enrollments (lead_id);

create index if not exists idx_sequence_enrollments_sequence
  on public.sequence_enrollments (sequence_id);

create index if not exists idx_email_sequence_run_items_lead
  on public.email_sequence_run_items (lead_id);

create index if not exists idx_email_dlq_message
  on public.email_dlq (message_id);

create index if not exists idx_scheduled_emails_lead
  on public.scheduled_emails (lead_id);

create index if not exists idx_lead_notes_author
  on public.lead_notes (author_id);

create index if not exists idx_social_post_events_target
  on public.social_post_events (target_id);

create index if not exists idx_sender_account_secrets_account
  on public.sender_account_secrets (sender_account_id);

create index if not exists idx_workspace_memory_created_by
  on public.workspace_memory (created_by)
  where created_by is not null;

-- ── 3. Redundant indexes ───────────────────────────────────────────────
--
-- Each of these has a composite index whose leftmost column is the same
-- column this single-column index covers. The planner uses the composite
-- for the prefix query, so the single-column form is dead weight (~8KB+
-- per index plus per-INSERT write amplification).

drop index if exists public.idx_audit_logs_user_id;
drop index if exists public.idx_email_links_message_id;
drop index if exists public.idx_email_messages_owner_id;
drop index if exists public.idx_esri_run;
drop index if exists public.idx_guest_contributors_user;
drop index if exists public.idx_guest_post_outreach_user;
drop index if exists public.idx_jobs_workspace;
drop index if exists public.idx_scheduled_emails_owner;
drop index if exists public.idx_sender_accounts_workspace;
drop index if exists public.idx_social_accounts_user_id;
drop index if exists public.idx_social_accounts_user;
drop index if exists public.idx_teamhub_activity_board;
drop index if exists public.idx_teamhub_comments_card;
drop index if exists public.idx_teamhub_flow_members_user;
drop index if exists public.idx_social_posts_status;
drop index if exists public.idx_leads_client_id;

-- ── 4. Documentation ──────────────────────────────────────────────────

comment on table public.api_idempotency is
  'Phase 4 — public API idempotency keys. RLS is enabled with zero policies on purpose: only the service-role api-* edge functions write here, and direct user access would defeat replay protection. Do not add user-facing policies.';
