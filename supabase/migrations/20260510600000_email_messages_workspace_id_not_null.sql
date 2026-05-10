-- ============================================================================
-- 20260510600000_email_messages_workspace_id_not_null.sql
-- ----------------------------------------------------------------------------
-- Final tightening of email_messages.workspace_id to NOT NULL.
--
-- Migration 20260508400000 added the column nullable + backfilled from
-- leads.workspace_id where lead_id was set. That left 20 historical rows
-- null in prod where the lead had no workspace_id (or was a test send
-- without a lead at all).
--
-- This migration:
--   1. Backfills any remaining nulls via owner_id → workspace_members
--      (the more reliable path; used unconditionally for idempotence on
--      fresh environments).
--   2. Asserts zero nulls remain (raises if any do — historical rows
--      whose owner_id has no workspace_member entry would survive both
--      backfills and need a manual fix).
--   3. Flips the column to NOT NULL.
--
-- Future inserts come from send-email which always sets workspace_id
-- (Phase 3.2.x). Phase 4.6.b vanity-domain SPA renders never write to
-- email_messages directly. So there should be no production source of
-- new null rows after this lands.
-- ============================================================================

-- ── 1. Backfill via workspace_members (single-line UPDATE FROM to avoid
--    a CLI parser hiccup on multi-line ORDER BY in CTEs) ────────────────────

UPDATE public.email_messages SET workspace_id = wm.workspace_id FROM public.workspace_members wm WHERE email_messages.workspace_id IS NULL AND email_messages.owner_id = wm.user_id;

-- ── 2. Assert + flip ──────────────────────────────────────────────────────

do $$
declare
  v_nulls int;
begin
  select count(*) into v_nulls from public.email_messages where workspace_id is null;
  if v_nulls > 0 then
    raise exception 'email_messages.workspace_id still has % null rows after backfill — investigate before flipping NOT NULL', v_nulls;
  end if;
end $$;

alter table public.email_messages alter column workspace_id set not null;
