-- ============================================================================
-- 20260510500000_db_refinement_pass3.sql
-- ----------------------------------------------------------------------------
-- DB schema refinement pass #3.
--
-- All additive. No behavior changes. Five missing indexes plus a conditional
-- tightening of email_messages.workspace_id to NOT NULL when backfill is
-- complete.
-- ============================================================================

-- ── 1. lead_tag_assignments — M2M join table, both directions queried ────

create index if not exists idx_lead_tag_assignments_lead
  on public.lead_tag_assignments (lead_id);

create index if not exists idx_lead_tag_assignments_tag
  on public.lead_tag_assignments (tag_id);

-- ── 2. team_invites — list per team + invite-acceptance email lookup ────

create index if not exists idx_team_invites_team
  on public.team_invites (team_id);

-- Partial: only pending invites are looked up by recipient email.
-- Accepted/declined rows are historical — no need to index them this way.
create index if not exists idx_team_invites_pending_email
  on public.team_invites (email)
  where status = 'pending';

-- ── 3. workspaces — owner_id query path (workspaces user owns) ──────────

create index if not exists idx_workspaces_owner
  on public.workspaces (owner_id);

-- ── 4. usage_counters — workspace + period_key composite ─────────────────

create index if not exists idx_usage_counters_workspace_period
  on public.usage_counters (workspace_id, period_key);

-- ── 5. email_messages.workspace_id NOT NULL (conditional) ───────────────
--
-- The Phase 3.2.1 backfill (migration 20260508400000) populated
-- workspace_id from leads.workspace_id. The Phase 3.2.x send-path
-- changes ensure new rows always have it set. This block flips the
-- column to NOT NULL only if zero nulls remain — otherwise it logs a
-- warning and leaves the column nullable. Idempotent on re-run.

do $$
declare
  v_nulls int;
  v_already_not_null boolean;
begin
  select is_nullable = 'NO' into v_already_not_null
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'email_messages'
    and column_name  = 'workspace_id';

  if v_already_not_null then
    raise notice '[refinement] email_messages.workspace_id already NOT NULL — skipping';
    return;
  end if;

  select count(*) into v_nulls
  from public.email_messages
  where workspace_id is null;

  if v_nulls = 0 then
    alter table public.email_messages alter column workspace_id set not null;
    raise notice '[refinement] email_messages.workspace_id flipped to NOT NULL (0 nulls found)';
  else
    raise warning '[refinement] email_messages.workspace_id has % null rows — NOT NULL constraint NOT applied. Backfill those rows then re-run this migration manually.', v_nulls;
  end if;
end $$;
