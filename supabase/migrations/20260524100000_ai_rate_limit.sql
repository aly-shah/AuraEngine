-- ============================================================================
-- 20260524100000_ai_rate_limit.sql
-- ----------------------------------------------------------------------------
-- Cluster-wide rate limit for AI edge functions (gemini-proxy, ai-chat-stream).
--
-- Replaces the in-memory Map<userId, timestamps[]> that lived inside each
-- worker — the map reset on cold start and didn't share state across workers
-- or regions, so a busy user could exceed the cap by hitting different
-- instances in parallel.
--
-- Mirrors api_rate_limit_buckets (Phase 4.2) but keyed on the auth user
-- UUID instead of api_keys.id, since AI calls come from authenticated
-- portal sessions, not API keys.
-- ============================================================================

create table if not exists public.ai_rate_limit_buckets (
  user_id       uuid        not null,
  bucket_minute timestamptz not null,
  count         int         not null default 0,
  primary key (user_id, bucket_minute)
);

create index if not exists idx_ai_rate_limit_purge
  on public.ai_rate_limit_buckets (bucket_minute);

-- Purge rows older than 1 hour.

create or replace function public.purge_ai_rate_limit_buckets()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ai_rate_limit_buckets
   where bucket_minute < now() - interval '1 hour';
$$;

revoke all on function public.purge_ai_rate_limit_buckets() from public;
grant execute on function public.purge_ai_rate_limit_buckets() to service_role;

do $$ begin
  perform cron.unschedule('purge-ai-rate-limit-buckets');
exception when others then null;
end $$;

-- Offset minute from the api-rate-limit purge (:07) to spread cron load.
select cron.schedule(
  'purge-ai-rate-limit-buckets',
  '23 * * * *',
  $$select public.purge_ai_rate_limit_buckets();$$
);

-- ── consume_ai_rate_limit(user_id, max_per_min) ───────────────────────────
--
-- Atomic UPSERT mirroring consume_api_rate_limit. Returns whether the
-- request is allowed under the per-minute cap.

create or replace function public.consume_ai_rate_limit(
  p_user_id     uuid,
  p_max_per_min int default 60
) returns table (
  allowed       boolean,
  current_count int,
  reset_at      timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
  v_count  int;
begin
  insert into public.ai_rate_limit_buckets (user_id, bucket_minute, count)
  values (p_user_id, v_bucket, 1)
  on conflict (user_id, bucket_minute)
  do update set count = public.ai_rate_limit_buckets.count + 1
  returning count into v_count;

  allowed       := v_count <= p_max_per_min;
  current_count := v_count;
  reset_at      := v_bucket + interval '1 minute';
  return next;
end;
$$;

revoke all on function public.consume_ai_rate_limit(uuid, int) from public;
grant execute on function public.consume_ai_rate_limit(uuid, int) to service_role;

comment on function public.consume_ai_rate_limit is
  'Cluster-wide per-user AI rate limit. Edge functions call this on every request; allowed=false means return 429.';
