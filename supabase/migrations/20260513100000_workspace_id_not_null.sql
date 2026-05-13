-- ============================================================================
-- 20260513100000_workspace_id_not_null.sql
-- ----------------------------------------------------------------------------
-- Four tables ship workspace_id as nullable today (Phase 3.5 backfill
-- artifact). The app code now assumes workspace scoping everywhere, so
-- a NULL row would silently leak across workspaces if it were ever
-- inserted. This migration:
--
--   1. Deletes a handful of clearly-orphan rows that have neither
--      workspace_id nor a recoverable owner. These were inspected
--      manually before this migration shipped:
--        - 4 leads: 3 had no email/name/owner (Apollo test imports
--          from 2026-03), 1 had email but lost its created_by FK
--        - 8 audit_logs: all USER_STATUS_UPDATE rows with NULL
--          user_id, NULL entity_id, NULL payload — early audit
--          writer that didn't capture context
--
--   2. Backfills the remaining 173 NULL-workspace rows from the
--      owning user's earliest workspace_members membership.
--      Verified pre-migration: every user with backfillable rows
--      has at least one workspace_members entry.
--
--   3. Adds NOT NULL on workspace_id for all four tables.
--
-- All inside a single transaction so a backfill miss aborts the lot.
-- ============================================================================

begin;

-- ── 1. Delete orphans (no user, no workspace, no recovery path) ────────

delete from public.audit_logs
 where workspace_id is null
   and user_id is null;

delete from public.leads
 where workspace_id is null
   and created_by is null;

-- ── 2. Backfill remaining NULLs from workspace_members ─────────────────

update public.audit_logs al
   set workspace_id = wm.workspace_id
  from public.workspace_members wm
 where al.workspace_id is null
   and al.user_id is not null
   and wm.user_id = al.user_id
   and wm.joined_at = (
     select min(joined_at) from public.workspace_members
     where user_id = al.user_id
   );

update public.subscriptions s
   set workspace_id = wm.workspace_id
  from public.workspace_members wm
 where s.workspace_id is null
   and s.user_id is not null
   and wm.user_id = s.user_id
   and wm.joined_at = (
     select min(joined_at) from public.workspace_members
     where user_id = s.user_id
   );

update public.email_sequence_runs esr
   set workspace_id = wm.workspace_id
  from public.workspace_members wm
 where esr.workspace_id is null
   and esr.owner_id is not null
   and wm.user_id = esr.owner_id
   and wm.joined_at = (
     select min(joined_at) from public.workspace_members
     where user_id = esr.owner_id
   );

-- leads: the only remaining NULL-workspace rows after the delete above
-- would be ones with created_by set but no workspace_members entry.
-- Pre-migration query showed 0 such rows; this update is here as a
-- safety net.
update public.leads l
   set workspace_id = wm.workspace_id
  from public.workspace_members wm
 where l.workspace_id is null
   and l.created_by is not null
   and wm.user_id = l.created_by
   and wm.joined_at = (
     select min(joined_at) from public.workspace_members
     where user_id = l.created_by
   );

-- ── 3. Hard-fail if any NULL workspace_id rows remain ──────────────────

do $$
declare
  remaining int;
begin
  select
      (select count(*) from public.leads where workspace_id is null) +
      (select count(*) from public.audit_logs where workspace_id is null) +
      (select count(*) from public.email_sequence_runs where workspace_id is null) +
      (select count(*) from public.subscriptions where workspace_id is null)
    into remaining;

  if remaining > 0 then
    raise exception 'workspace_id backfill incomplete: % rows still null. Aborting.', remaining;
  end if;
end $$;

-- ── 4. Apply NOT NULL ──────────────────────────────────────────────────

alter table public.leads               alter column workspace_id set not null;
alter table public.audit_logs          alter column workspace_id set not null;
alter table public.email_sequence_runs alter column workspace_id set not null;
alter table public.subscriptions       alter column workspace_id set not null;

commit;
