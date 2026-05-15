-- ============================================================================
-- 20260515100000_profiles_createdAt_drop.sql
-- ----------------------------------------------------------------------------
-- Finally remove the camelCase "createdAt" column on profiles. Three
-- prior migrations led here:
--
--   20260513110000 — comment-deprecated the duplicate column
--   20260514120000 — converted it to GENERATED ALWAYS AS (created_at)
--                    so divergence became impossible
--   <code commit 7a4615d> — renamed User.createdAt → User.created_at
--                           across types.ts, BillingPage, the 4 admin
--                           pages, and the 3 admin console tabs.
--                           Deployed and verified before this drop.
--
-- Safe because:
--   - the column was generated, so nothing wrote to it independently
--   - every active SELECT that named the column has been updated
--   - fetchProfile and pollForProfile use select('*') and will
--     naturally stop returning the column after this migration
--   - the User TS type no longer references it
--
-- Old browser bundles cached from before commit 7a4615d would query
-- `createdAt` and receive a "column does not exist" PostgREST error.
-- That window closes as those sessions refresh — minimal user impact.
-- ============================================================================

alter table public.profiles
  drop column if exists "createdAt";

comment on column public.profiles.created_at is
  'Row-creation timestamp. The legacy camelCase "createdAt" column was dropped 2026-05-15.';
