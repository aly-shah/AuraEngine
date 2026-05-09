-- ============================================================================
-- 20260510200000_api_idempotency.sql
-- ----------------------------------------------------------------------------
-- Phase 4.2 (writes) — idempotency for the public REST API.
--
-- Stripe-style: the client sends `Idempotency-Key: <any-string>` on
-- mutating requests. We store the key + a hash of the body + the
-- response. If the same key arrives again with the same body, we
-- return the cached response. If the same key arrives with a DIFFERENT
-- body, we return 409 (key reuse with different request).
--
-- Keys live 24h then a cron purge sweeps. Long-lived keys are out of
-- scope; the contract is "safe to retry within a day".
-- ============================================================================

create table if not exists public.api_idempotency (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  key             text not null,
  api_key_id      uuid references public.api_keys(id) on delete set null,
  endpoint        text not null,                      -- e.g. 'POST /v1-leads'
  request_hash    text not null,                      -- sha256 hex of request body
  response_status int  not null,
  response_body   jsonb not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '24 hours',
  primary key (workspace_id, key)
);

create index if not exists idx_api_idempotency_purge
  on public.api_idempotency (expires_at);

-- No RLS: this table is service-role only (edge functions). No user
-- needs direct access. Keep policies absent → deny by default for
-- anon/authenticated.
alter table public.api_idempotency enable row level security;

-- Hourly purge.

create or replace function public.purge_api_idempotency()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_idempotency where expires_at < now();
$$;

revoke all on function public.purge_api_idempotency() from public;
grant execute on function public.purge_api_idempotency() to service_role;

do $$ begin
  perform cron.unschedule('purge-api-idempotency');
exception when others then null;
end $$;

select cron.schedule(
  'purge-api-idempotency',
  '13 * * * *',  -- offset from analytics (10m) / campaign-memory (:17) / sender-health (:22) / api-rate-limit (:7)
  $$select public.purge_api_idempotency();$$
);

comment on table public.api_idempotency is
  'Phase 4.2 — Idempotency cache for mutating public-API requests. Edge function checks (workspace_id, key) BEFORE doing the mutation, replays the cached response on hit. 24h TTL.';
