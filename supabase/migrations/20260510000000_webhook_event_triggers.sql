-- ============================================================================
-- 20260510000000_webhook_event_triggers.sql
-- ----------------------------------------------------------------------------
-- Phase 4.3 (events) — wire AFTER triggers on the canonical tables that
-- enqueue webhook deliveries via queue_webhook_event.
--
-- Events fired:
--   lead.created          — leads INSERT
--   lead.updated          — leads UPDATE OF status (only when status actually changes)
--   sequence.completed    — email_sequence_runs UPDATE (when status → 'completed')
--   email.sent            — email_messages INSERT (status = 'sent', not 'failed')
--   email.bounced         — email_dlq INSERT (kind = 'hard_bounce')
--   email.spam_complaint  — email_dlq INSERT (kind = 'spam_complaint')
--   email.unsubscribed    — email_dlq INSERT (kind = 'unsubscribed')
--
-- Fan-out is via queue_webhook_event(workspace_id, type, payload), which
-- only writes rows for endpoints that subscribe to the event. So a
-- workspace with no webhook_endpoints incurs ~1 cheap COUNT-style query
-- per mutation, no actual delivery rows.
--
-- Safety: every trigger is wrapped in EXCEPTION WHEN OTHERS that swallows
-- failures with RAISE WARNING. A webhook fan-out failure must NEVER block
-- the underlying mutation.
-- ============================================================================

-- Compact event-payload helpers — keep payloads small + stable.

create or replace function public._wh_lead_payload(l public.leads)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id',            l.id,
    'workspace_id',  l.workspace_id,
    'first_name',    l.first_name,
    'last_name',     l.last_name,
    'primary_email', l.primary_email,
    'company',       l.company,
    'status',        l.status,
    'score',         l.score,
    'source',        l.source,
    'created_at',    l.created_at,
    'updated_at',    l.updated_at
  );
$$;

-- ── leads INSERT → lead.created ─────────────────────────────────────────

create or replace function public._wh_after_lead_insert()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.workspace_id is not null then
    perform public.queue_webhook_event(
      new.workspace_id, 'lead.created', public._wh_lead_payload(new)
    );
  end if;
  return null;
exception when others then
  raise warning '[wh] lead.created enqueue failed: % %', sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_wh_lead_insert on public.leads;
create trigger trg_wh_lead_insert
  after insert on public.leads
  for each row execute function public._wh_after_lead_insert();

-- ── leads UPDATE (status changed) → lead.updated ────────────────────────

create or replace function public._wh_after_lead_status_update()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.workspace_id is not null and (old.status is distinct from new.status) then
    perform public.queue_webhook_event(
      new.workspace_id,
      'lead.updated',
      public._wh_lead_payload(new) || jsonb_build_object(
        'previous_status', old.status,
        'changed_field',   'status'
      )
    );
  end if;
  return null;
exception when others then
  raise warning '[wh] lead.updated enqueue failed: % %', sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_wh_lead_status_update on public.leads;
create trigger trg_wh_lead_status_update
  after update of status on public.leads
  for each row execute function public._wh_after_lead_status_update();

-- ── email_sequence_runs UPDATE → sequence.completed ─────────────────────

create or replace function public._wh_after_seq_run_update()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_workspace_id uuid;
begin
  -- Only fire when status transitions INTO 'completed'.
  if new.status is distinct from old.status and new.status = 'completed' then
    -- email_sequence_runs.workspace_id may be null on legacy rows; fall back
    -- to deriving from owner_id → workspace_members.
    v_workspace_id := new.workspace_id;
    if v_workspace_id is null then
      select workspace_id into v_workspace_id
        from public.workspace_members
        where user_id = new.owner_id
        order by created_at asc
        limit 1;
    end if;

    if v_workspace_id is not null then
      perform public.queue_webhook_event(
        v_workspace_id,
        'sequence.completed',
        jsonb_build_object(
          'id',           new.id,
          'workspace_id', v_workspace_id,
          'lead_count',   new.lead_count,
          'step_count',   new.step_count,
          'items_total',  new.items_total,
          'items_done',   new.items_done,
          'items_failed', new.items_failed,
          'started_at',   new.started_at,
          'completed_at', new.completed_at,
          'config',       new.sequence_config
        )
      );
    end if;
  end if;
  return null;
exception when others then
  raise warning '[wh] sequence.completed enqueue failed: % %', sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_wh_seq_run_update on public.email_sequence_runs;
create trigger trg_wh_seq_run_update
  after update of status on public.email_sequence_runs
  for each row execute function public._wh_after_seq_run_update();

-- ── email_messages INSERT → email.sent ──────────────────────────────────

create or replace function public._wh_after_email_message_insert()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.workspace_id is not null and new.status = 'sent' then
    perform public.queue_webhook_event(
      new.workspace_id,
      'email.sent',
      jsonb_build_object(
        'id',                 new.id,
        'workspace_id',       new.workspace_id,
        'lead_id',            new.lead_id,
        'sender_account_id',  new.sender_account_id,
        'sequence_id',        new.sequence_id,
        'sequence_step',      new.sequence_step,
        'provider',           new.provider,
        'to_email',           new.to_email,
        'from_email',         new.from_email,
        'subject',            new.subject,
        'created_at',         new.created_at
      )
    );
  end if;
  return null;
exception when others then
  raise warning '[wh] email.sent enqueue failed: % %', sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_wh_email_message_insert on public.email_messages;
create trigger trg_wh_email_message_insert
  after insert on public.email_messages
  for each row execute function public._wh_after_email_message_insert();

-- ── email_dlq INSERT → email.bounced / email.spam_complaint / email.unsubscribed ──

create or replace function public._wh_after_email_dlq_insert()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  v_event text;
begin
  v_event := case new.kind
    when 'hard_bounce'    then 'email.bounced'
    when 'spam_complaint' then 'email.spam_complaint'
    when 'unsubscribed'   then 'email.unsubscribed'
    else null
  end;

  if v_event is not null and new.workspace_id is not null then
    perform public.queue_webhook_event(
      new.workspace_id,
      v_event,
      jsonb_build_object(
        'id',                 new.id,
        'workspace_id',       new.workspace_id,
        'sender_account_id',  new.sender_account_id,
        'message_id',         new.message_id,
        'to_email',           new.to_email,
        'kind',               new.kind,
        'reason',             new.reason,
        'first_failed_at',    new.first_failed_at,
        'last_failed_at',     new.last_failed_at
      )
    );
  end if;
  return null;
exception when others then
  raise warning '[wh] %.enqueue failed: % %', new.kind, sqlstate, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_wh_email_dlq_insert on public.email_dlq;
create trigger trg_wh_email_dlq_insert
  after insert on public.email_dlq
  for each row execute function public._wh_after_email_dlq_insert();

-- ── Document the canonical event catalogue at schema level ──────────────

comment on function public.queue_webhook_event is
  'Phase 4.3 — fan-out an event to all matching webhook_endpoints. Returns the number of deliveries queued. Canonical event types fired by triggers in 20260510000000: lead.created, lead.updated, sequence.completed, email.sent, email.bounced, email.spam_complaint, email.unsubscribed. Apps may also queue custom events (e.g. test.ping from the UI).';
