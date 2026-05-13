-- ============================================================================
-- 20260513110000_profiles_createdAt_deprecate.sql
-- ----------------------------------------------------------------------------
-- profiles has TWO timestamp columns that both default to now() on row
-- creation: "createdAt" (camelCase, legacy) and created_at (canonical
-- snake_case). The audit flagged this as a duplicate-column smell.
--
-- The camelCase variant is still bound by fetchProfile / pollForProfile
-- which both `select('*')`, and the User TS interface uses createdAt.
-- A coordinated drop requires updating those auth-flow files; staging
-- this as a comment-only deprecation now so the intent is recorded.
--
-- Standalone admin queries (admin/AdminDashboard.tsx, admin/User
-- Management.tsx, lib/support.ts) have already been migrated to read
-- via `createdAt:created_at` aliasing or to use created_at directly,
-- so they survive the eventual drop.
--
-- Once the auth flow files are updated, a follow-up migration can
-- safely:
--   alter table public.profiles drop column "createdAt";
-- ============================================================================

comment on column public.profiles."createdAt" is
  'DEPRECATED — duplicate of created_at. Both columns default to now() at signup and stay in sync because no UPDATE statement writes either one. Pending coordinated removal: fetchProfile in AuraEngine/hooks/useAuthMachine.ts and pollForProfile in AuraEngine/pages/portal/AuthPage.tsx still bind this name implicitly via `select(*)`, and the User TS interface (AuraEngine/types.ts:29) is named createdAt. New code MUST read created_at instead.';

comment on column public.profiles.created_at is
  'Canonical row-creation timestamp. Use this column; "createdAt" is deprecated (see its comment).';
