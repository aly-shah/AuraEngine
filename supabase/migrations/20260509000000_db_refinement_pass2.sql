-- ============================================================================
-- 20260509000000_db_refinement_pass2.sql
-- ----------------------------------------------------------------------------
-- DB schema refinement pass #2.
--
-- Two structural fixes:
--
-- 1. Re-point 8 workspace_id FKs from profiles(id) → workspaces(id).
--    Pre-flight (run as a throwaway migration earlier) verified ZERO orphan
--    rows in all 8 tables, so the FK swap is safe — every existing
--    workspace_id is already in workspaces. The drift dates from before the
--    workspace rewrite (20260305200002) when profiles.id WAS the workspace
--    identifier.
--
-- 2. Add 5 missing indexes on workspace_id columns:
--      email_sequence_runs, import_batches, lead_notes, notifications, subscriptions
--
-- Both changes are additive in effect: no rows are touched, no behavior
-- changes for current code paths. The FK swap unifies the schema's
-- canonical convention so future migrations don't have to re-derive
-- "which target should I FK to?" from history. The indexes turn linear
-- workspace-scoped scans into lookups.
-- ============================================================================

-- ── 1. Re-point workspace_id FKs to workspaces(id) ─────────────────────────
--
-- Each block: drop the existing FK (which targets profiles), add the
-- canonical FK (which targets workspaces). Wrapped in DO blocks so we can
-- look up the constraint name dynamically — different migrations may have
-- assigned different names over time.

do $$
declare
  v_table text;
  v_cname text;
begin
  foreach v_table in array array[
    'ai_messages',
    'ai_threads',
    'import_batches',
    'sender_accounts',
    'usage_events',
    'workspace_ai_usage',
    'workspace_entitlements',
    'workspace_usage_counters'
  ]
  loop
    select tc.constraint_name
      into v_cname
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu
           using (constraint_name, table_schema)
     where tc.table_schema    = 'public'
       and tc.table_name      = v_table
       and tc.constraint_type = 'FOREIGN KEY'
       and ccu.table_name     = 'profiles'
       and ccu.column_name    = 'id'
     limit 1;

    if v_cname is not null then
      execute format('alter table public.%I drop constraint %I', v_table, v_cname);
      execute format(
        'alter table public.%I add constraint %I '
        || 'foreign key (workspace_id) references public.workspaces(id) on delete cascade',
        v_table, v_table || '_workspace_id_fkey'
      );
      raise notice 'Re-pointed %.%I → workspaces(id)', v_table, 'workspace_id';
    else
      raise notice 'Skipped % — no profiles-targeted workspace_id FK found (already migrated?)', v_table;
    end if;
  end loop;
end $$;

-- ── 2. Add missing indexes on workspace_id ────────────────────────────────
--
-- All 5 named here have a workspace_id column but no supporting index.
-- Most queries against these tables are workspace-scoped (RLS, dashboards,
-- backfills), so a btree on workspace_id alone is the right starting point.
-- IF NOT EXISTS keeps the migration idempotent.

create index if not exists idx_email_sequence_runs_workspace
  on public.email_sequence_runs (workspace_id);

create index if not exists idx_import_batches_workspace
  on public.import_batches (workspace_id);

create index if not exists idx_lead_notes_workspace
  on public.lead_notes (workspace_id);

create index if not exists idx_notifications_workspace
  on public.notifications (workspace_id);

create index if not exists idx_subscriptions_workspace
  on public.subscriptions (workspace_id);
