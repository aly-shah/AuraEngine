-- ============================================================================
-- 20260508500000_send_path_data_migration.sql
-- ----------------------------------------------------------------------------
-- Phase 3.2.1 — data migration + counter helpers.
--
-- Two pieces:
--
-- 1. One-shot idempotent data migration of email_provider_configs rows into
--    sender_accounts + sender_account_secrets, deduped on the existing
--    UNIQUE (workspace_id, provider, from_email) index.
--
-- 2. Two RPC helpers — reset_sender_failures and increment_sender_failures —
--    that send-email will call on success/failure to maintain the
--    consecutive_failures counter introduced in Phase 3.1.
--
-- Phase 3.2.1 deliberately does NOT change which credentials send-email
-- uses (still email_provider_configs). It only ensures sender_accounts is
-- populated in lockstep so the next session can flip the credential source
-- with confidence that every active config has a matching sender_accounts
-- row.
-- ============================================================================

-- ── 1. Migrate email_provider_configs → sender_accounts ───────────────────

insert into public.sender_accounts (
  workspace_id, provider, from_email, from_name, display_name,
  status, use_for_outreach, metadata
)
select
  epc.owner_id                                             as workspace_id,
  epc.provider                                             as provider,
  coalesce(epc.from_email, epc.smtp_user, '')              as from_email,
  coalesce(epc.from_name, '')                              as from_name,
  coalesce(epc.from_name, epc.from_email, epc.provider)    as display_name,
  case when epc.is_active then 'connected' else 'disabled' end as status,
  true                                                     as use_for_outreach,
  jsonb_build_object('migrated_from_epc', epc.id)          as metadata
from public.email_provider_configs epc
where epc.is_active
on conflict (workspace_id, provider, from_email) do nothing;

-- Migrate secrets. Use a CTE that resolves the matching sender_accounts row
-- (whether just-inserted or pre-existing) and upserts the secrets keyed on
-- sender_account_id (which has a UNIQUE constraint).
with target as (
  select
    sa.id           as sender_account_id,
    epc.api_key,
    epc.smtp_host,
    epc.smtp_port,
    epc.smtp_user,
    epc.smtp_pass
  from public.email_provider_configs epc
  join public.sender_accounts sa on
        sa.workspace_id = epc.owner_id
    and sa.provider     = epc.provider
    and lower(coalesce(sa.from_email,''))  = lower(coalesce(epc.from_email, epc.smtp_user, ''))
  where epc.is_active
)
insert into public.sender_account_secrets (
  sender_account_id, api_key, smtp_host, smtp_port, smtp_user, smtp_pass
)
select sender_account_id, api_key, smtp_host, smtp_port, smtp_user, smtp_pass
from target
on conflict (sender_account_id) do update set
  api_key   = coalesce(excluded.api_key,   public.sender_account_secrets.api_key),
  smtp_host = coalesce(excluded.smtp_host, public.sender_account_secrets.smtp_host),
  smtp_port = coalesce(excluded.smtp_port, public.sender_account_secrets.smtp_port),
  smtp_user = coalesce(excluded.smtp_user, public.sender_account_secrets.smtp_user),
  smtp_pass = coalesce(excluded.smtp_pass, public.sender_account_secrets.smtp_pass),
  updated_at = now();

-- ── 2. Failure-counter helpers ────────────────────────────────────────────

create or replace function public.reset_sender_failures(p_sender_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sender_accounts
     set consecutive_failures = 0,
         updated_at           = now()
   where id = p_sender_id and consecutive_failures > 0;
$$;

revoke all on function public.reset_sender_failures(uuid) from public;
grant execute on function public.reset_sender_failures(uuid) to service_role;

comment on function public.reset_sender_failures is
  'Phase 3.2.1 — called from send-email on a successful send to clear the consecutive-failures circuit-breaker counter.';

create or replace function public.increment_sender_failures(p_sender_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  update public.sender_accounts
     set consecutive_failures = consecutive_failures + 1,
         updated_at           = now()
   where id = p_sender_id
   returning consecutive_failures into v_new;
  return coalesce(v_new, 0);
end;
$$;

revoke all on function public.increment_sender_failures(uuid) from public;
grant execute on function public.increment_sender_failures(uuid) to service_role;

comment on function public.increment_sender_failures is
  'Phase 3.2.1 — called from send-email on a failed send. The Phase 3.1 sender_daily_cap halves the cap when consecutive_failures pushes health_score below 50 on the next refresh.';
