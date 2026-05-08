-- ============================================================================
-- 20260508100000_lead_memory_email_tracking.sql
-- ----------------------------------------------------------------------------
-- Phase 2.1 — first feedback writer for the AI memory layer.
--
-- When the email-track edge function records an open or click event, also
-- append a lead_memory row so the AI can see prior interactions with this
-- lead. The function is SECURITY DEFINER so it can be called from the edge
-- (service-role context) and write into RLS-protected lead_memory.
--
-- Bot and Apple-privacy-cache events are skipped — they're noise and would
-- pollute the memory layer with false-positive signals.
--
-- Errors are swallowed (RAISE WARNING, not EXCEPTION) so a memory write
-- failure can never break email tracking, which is part of the revenue
-- pipeline.
--
-- Workspace resolution: joins via leads.workspace_id (the canonical source,
-- present since migration 20260305200001) rather than relying on a
-- workspace_id column on email_messages. This keeps the function robust
-- across environments where the email_messages.workspace_id column may not
-- have been added.
-- ============================================================================

create or replace function public.log_lead_memory_email_event(
  p_message_id        uuid,
  p_event_type        text,
  p_link_id           uuid default null,
  p_destination_url   text default null,
  p_is_bot            boolean default false,
  p_is_apple_privacy  boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id      uuid;
  v_workspace_id uuid;
begin
  -- Skip noise: bots and Apple privacy proxy opens.
  if p_is_bot or p_is_apple_privacy then
    return;
  end if;

  -- Only record outcomes we care about for memory.
  if p_event_type not in ('open', 'click', 'delivered', 'bounced', 'replied') then
    return;
  end if;

  -- Resolve lead + workspace from the message.
  select em.lead_id, l.workspace_id
    into v_lead_id, v_workspace_id
  from public.email_messages em
  join public.leads l on l.id = em.lead_id
  where em.id = p_message_id
  limit 1;

  -- If we can't tie back to a lead+workspace (e.g. test send), skip silently.
  if v_lead_id is null or v_workspace_id is null then
    return;
  end if;

  insert into public.lead_memory (
    workspace_id, lead_id, kind, value, source, confidence, tags, occurred_at
  )
  values (
    v_workspace_id,
    v_lead_id,
    'interaction',
    jsonb_build_object(
      'event', p_event_type,
      'message_id', p_message_id,
      'link_id', p_link_id,
      'destination_url', p_destination_url
    ),
    'email_track',
    case p_event_type
      when 'replied'   then 0.95
      when 'click'     then 0.85
      when 'open'      then 0.55
      when 'delivered' then 0.30
      when 'bounced'   then 0.40
      else 0.50
    end,
    array['email', 'interaction', p_event_type],
    now()
  );
exception when others then
  -- Never break tracking just because memory write failed.
  raise warning 'log_lead_memory_email_event failed: % %', sqlstate, sqlerrm;
end;
$$;

-- Lock down execution to the service role (edge function context only).
revoke all on function public.log_lead_memory_email_event(uuid, text, uuid, text, boolean, boolean) from public;
grant execute on function public.log_lead_memory_email_event(uuid, text, uuid, text, boolean, boolean) to service_role;

comment on function public.log_lead_memory_email_event is
  'Phase 2.1 memory writer. Turns email open/click/reply/bounce events into lead_memory rows so the AI can recall prior interactions. Bot and Apple privacy events are ignored. Errors are warned (not raised) to keep email tracking unbreakable.';
