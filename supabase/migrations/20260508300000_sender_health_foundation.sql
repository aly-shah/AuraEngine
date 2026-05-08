-- ============================================================================
-- 20260508300000_sender_health_foundation.sql
-- ----------------------------------------------------------------------------
-- Phase 3.1 — Sender health foundation.
--
-- This migration is PURELY ADDITIVE. The send path (send-email edge function)
-- is NOT modified. Today, sends still go through email_provider_configs and
-- email_messages.sender_account_id is left null for new rows. Phase 3.2 will
-- cut the send path over to sender_accounts and populate sender_account_id;
-- when that happens, this foundation lights up automatically.
--
-- What this adds:
--   1. email_messages.sender_account_id  (nullable FK)
--   2. sender_accounts.* health metrics  (visibility columns)
--   3. email_dlq                         (table for hard-bounce / unrecoverable failures)
--   4. compute_sender_health(sender_id)  (refreshes health_score / rates from events)
--   5. sender_daily_cap(sender_id)       (warmup-aware + health-aware daily cap)
--   6. pick_outreach_sender(workspace)   (selection function, nothing calls it yet)
--   7. pg_cron refresh-sender-health     (hourly health refresh)
--
-- Safety properties:
--   * No existing column or row is modified.
--   * No RPC currently invoked by edge functions changes.
--   * If sender_account_id stays null on email_messages, compute_sender_health
--     reports `not_enough_data` for that sender and leaves health_score=100.
--   * pick_outreach_sender returns no rows for workspaces with no senders
--     enrolled — callers must handle empty result by falling back to legacy.
-- ============================================================================

-- ── 1. email_messages.sender_account_id ────────────────────────────────────

alter table public.email_messages
  add column if not exists sender_account_id uuid
    references public.sender_accounts(id) on delete set null;

create index if not exists idx_email_messages_sender_account_created
  on public.email_messages (sender_account_id, created_at desc)
  where sender_account_id is not null;

comment on column public.email_messages.sender_account_id is
  'Phase 3.1 — set by send-email when Phase 3.2 cutover lands. Joins email_events to a sender for health computation.';

-- ── 2. Visibility columns on sender_accounts ───────────────────────────────

alter table public.sender_accounts
  add column if not exists bounce_rate_7d      numeric(5,4) not null default 0,
  add column if not exists complaint_rate_7d   numeric(5,4) not null default 0,
  add column if not exists consecutive_failures int         not null default 0;

comment on column public.sender_accounts.bounce_rate_7d is
  'Rolling 7-day bounce rate (bounces / sent), refreshed by cron-driven compute_sender_health.';
comment on column public.sender_accounts.complaint_rate_7d is
  'Rolling 7-day spam-complaint rate (spam_report events / sent).';
comment on column public.sender_accounts.consecutive_failures is
  'Reset to 0 on successful send. Incremented on send-time failures. Used to circuit-break a flapping sender.';

-- ── 3. email_dlq table ─────────────────────────────────────────────────────

create table if not exists public.email_dlq (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.profiles(id) on delete cascade,
  sender_account_id uuid references public.sender_accounts(id) on delete set null,
  message_id        uuid references public.email_messages(id) on delete set null,
  to_email          text not null,
  kind              text not null check (kind in (
    'hard_bounce','spam_complaint','rate_limited','provider_error','unsubscribed','other'
  )),
  reason            text,
  retry_count       int not null default 0,
  first_failed_at   timestamptz not null default now(),
  last_failed_at    timestamptz not null default now(),
  metadata          jsonb not null default '{}'
);

create index if not exists idx_email_dlq_workspace_kind
  on public.email_dlq (workspace_id, kind, last_failed_at desc);
create index if not exists idx_email_dlq_sender
  on public.email_dlq (sender_account_id, last_failed_at desc)
  where sender_account_id is not null;

alter table public.email_dlq enable row level security;

create policy email_dlq_select on public.email_dlq
  for select using (workspace_id = auth.uid());
-- No INSERT/UPDATE/DELETE for users — only service_role (edge functions) writes.

comment on table public.email_dlq is
  'Phase 3.1 — dead-letter queue for unrecoverable email failures. Populated by Phase 3.2 send-email when a hard bounce or spam complaint comes in. Inspected from /admin/ops in a future ship.';

-- ── 4. compute_sender_health(sender_id) ────────────────────────────────────
--
-- Aggregates the last 7 days of email_messages + email_events for a sender
-- and updates the sender's health_score, bounce_rate_7d, complaint_rate_7d,
-- last_health_check_at. Returns the new health score.
--
-- Score formula:
--   start = 100
--   - bounce_rate * 200       (5% bounce = -10pt; 10% bounce = -20pt)
--   - complaint_rate * 5000   (0.1% spam = -5pt; 0.5% spam = -25pt)
--   - consecutive_failures * 5
--   clamped to [0,100].
--
-- If <7 days of data, cap at 95 (probationary).

create or replace function public.compute_sender_health(p_sender_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sent             int;
  v_bounces          int;
  v_complaints       int;
  v_consec           int;
  v_account_age_days numeric;
  v_bounce_rate      numeric(5,4);
  v_complaint_rate   numeric(5,4);
  v_score            int;
begin
  select extract(epoch from (now() - created_at)) / 86400.0
    into v_account_age_days
    from public.sender_accounts where id = p_sender_id;
  if v_account_age_days is null then
    return null;
  end if;

  select coalesce(consecutive_failures, 0)
    into v_consec from public.sender_accounts where id = p_sender_id;

  -- Sent in last 7 days for this sender
  select count(*)
    into v_sent
    from public.email_messages em
    where em.sender_account_id = p_sender_id
      and em.created_at >= now() - interval '7 days'
      and em.status in ('sent','delivered','bounced','failed');

  if v_sent = 0 then
    -- No data → leave score at 100; mark check time.
    update public.sender_accounts
       set last_health_check_at = now(),
           bounce_rate_7d = 0,
           complaint_rate_7d = 0
     where id = p_sender_id;
    return 100;
  end if;

  -- Bounces and spam complaints from event log
  select
    count(*) filter (where ee.event_type = 'bounced'),
    count(*) filter (where ee.event_type = 'spam_report')
    into v_bounces, v_complaints
    from public.email_events ee
    join public.email_messages em on em.id = ee.message_id
    where em.sender_account_id = p_sender_id
      and em.created_at >= now() - interval '7 days';

  v_bounce_rate    := round(v_bounces::numeric    / nullif(v_sent, 0), 4);
  v_complaint_rate := round(v_complaints::numeric / nullif(v_sent, 0), 4);

  v_score := 100
    - round(v_bounce_rate    * 200)
    - round(v_complaint_rate * 5000)
    - (v_consec * 5);

  -- Probationary cap for new senders (<7 days of history).
  if v_account_age_days < 7 then
    v_score := least(v_score, 95);
  end if;

  v_score := greatest(0, least(100, v_score));

  update public.sender_accounts
     set health_score         = v_score,
         bounce_rate_7d       = v_bounce_rate,
         complaint_rate_7d    = v_complaint_rate,
         last_health_check_at = now()
   where id = p_sender_id;

  return v_score;
exception when others then
  raise warning 'compute_sender_health failed for %: % %', p_sender_id, sqlstate, sqlerrm;
  return null;
end;
$$;

revoke all on function public.compute_sender_health(uuid) from public;
grant execute on function public.compute_sender_health(uuid) to service_role;

comment on function public.compute_sender_health is
  'Phase 3.1 — recomputes health_score, bounce_rate_7d, complaint_rate_7d from last 7 days of email_messages + email_events. Returns the new score.';

-- ── 5. sender_daily_cap(sender_id) ─────────────────────────────────────────
--
-- Returns the daily send cap for a sender, accounting for warmup ramp and
-- current health.
--   - warmup_enabled and account < 21 days: ramp from 50 (day 0) → 500 (day 21)
--   - otherwise: 500
--   - health_score < 50: cap halved
--   - health_score < 25: cap = 0  (circuit break)

create or replace function public.sender_daily_cap(p_sender_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_warmup       boolean;
  v_age_days     numeric;
  v_health       int;
  v_base_cap     int;
begin
  select warmup_enabled,
         extract(epoch from (now() - created_at)) / 86400.0,
         coalesce(health_score, 100)
    into v_warmup, v_age_days, v_health
    from public.sender_accounts where id = p_sender_id;

  if v_warmup is null then return 0; end if;

  if v_warmup and v_age_days < 21 then
    v_base_cap := 50 + floor((v_age_days / 21.0) * 450)::int;
  else
    v_base_cap := 500;
  end if;

  if v_health < 25 then return 0; end if;
  if v_health < 50 then return v_base_cap / 2; end if;
  return v_base_cap;
end;
$$;

revoke all on function public.sender_daily_cap(uuid) from public;
grant execute on function public.sender_daily_cap(uuid) to service_role, authenticated;

comment on function public.sender_daily_cap is
  'Phase 3.1 — returns the daily send cap for a sender. 50→500 ramp over 21 days when warmup_enabled, halved if health_score<50, zero if <25.';

-- ── 6. pick_outreach_sender(workspace_id) ──────────────────────────────────
--
-- Returns the single best sender for an outbound message in a workspace, or
-- no rows if none are available. Nothing currently calls this; Phase 3.2
-- will wire it into send-email.

create or replace function public.pick_outreach_sender(p_workspace_id uuid)
returns table (
  sender_id    uuid,
  provider     text,
  from_email   text,
  health_score int,
  daily_cap    int,
  daily_sent   int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    sa.id,
    sa.provider,
    sa.from_email,
    sa.health_score,
    public.sender_daily_cap(sa.id) as cap,
    -- Auto-reset stale daily counters
    case when sa.daily_sent_date = current_date then sa.daily_sent_today else 0 end as sent
  from public.sender_accounts sa
  where sa.workspace_id     = p_workspace_id
    and sa.status           = 'connected'
    and sa.use_for_outreach = true
    and coalesce(sa.health_score, 100) >= 25
  order by
    -- Prefer the healthiest, least-utilised sender.
    sa.health_score desc nulls last,
    case when sa.daily_sent_date = current_date then sa.daily_sent_today else 0 end::numeric
      / greatest(public.sender_daily_cap(sa.id), 1)::numeric asc,
    sa.created_at asc
  limit 1
  -- Caller must check daily_sent < daily_cap; we don't filter here so we can
  -- still return a sender that's at cap with an explicit signal.
  ;
end;
$$;

revoke all on function public.pick_outreach_sender(uuid) from public;
grant execute on function public.pick_outreach_sender(uuid) to service_role;

comment on function public.pick_outreach_sender is
  'Phase 3.1 — selects the best outreach sender for a workspace ordered by health then utilisation. Returns 0 rows if no eligible senders. Caller still must verify daily_sent < daily_cap.';

-- ── 7. Cron sweep: refresh-sender-health ───────────────────────────────────

create or replace function public.cron_refresh_sender_health()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_id uuid;
  v_count     int := 0;
begin
  for v_sender_id in
    select id from public.sender_accounts
     where status = 'connected'
       and use_for_outreach = true
     order by coalesce(last_health_check_at, 'epoch'::timestamptz) asc
     limit 200
  loop
    perform public.compute_sender_health(v_sender_id);
    v_count := v_count + 1;
  end loop;
end;
$$;

revoke all on function public.cron_refresh_sender_health() from public;
grant execute on function public.cron_refresh_sender_health() to service_role;

do $$
begin
  perform cron.unschedule('refresh-sender-health');
exception when others then null;
end $$;

select cron.schedule(
  'refresh-sender-health',
  '22 * * * *',  -- offset from analytics (every 10m) and campaign-memory (:17)
  $$select public.cron_refresh_sender_health();$$
);
