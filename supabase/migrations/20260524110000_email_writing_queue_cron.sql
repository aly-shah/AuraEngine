-- ============================================================================
-- 20260524110000_email_writing_queue_cron.sql
-- ----------------------------------------------------------------------------
-- pg_cron backstop for the AI email-writing queue.
--
-- Before this migration the queue was only drained by a client-side trigger
-- in lib/emailWriterQueue.ts. If the user closed the tab between
-- start-email-sequence-run inserting items and the queue draining, items
-- sat in 'pending' until something else woke them — typically only the
-- next time a user kicked off another sequence in the same workspace.
--
-- This adds a per-minute cron that calls process-email-writing-queue with
-- the service-role token. The client-side trigger stays in place as the
-- fast-start path; cron is the safety net.
--
-- Token resolution mirrors the hybrid GUC + vault pattern from
-- 20260518120000_cron_auth_hybrid.sql.
-- ============================================================================

create or replace function public.invoke_email_writing_queue()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url    text := 'https://utvydxqiqedaaxmmpfpf.functions.supabase.co/process-email-writing-queue';
  v_token  text;
  v_req_id bigint;
  v_pending int;
begin
  -- Cheap pre-check: skip the HTTP call entirely when nothing's queued.
  select count(*) into v_pending
    from public.email_sequence_run_items
   where status in ('pending', 'writing')
   limit 1;
  if v_pending = 0 then
    return null;
  end if;

  v_token := nullif(current_setting('app.settings.service_role_key', true), '');
  if v_token is null then
    select decrypted_secret into v_token
      from vault.decrypted_secrets
     where name = 'webhook_dispatcher_service_key' limit 1;
  end if;
  if v_token is null or v_token = '' then
    raise warning 'invoke_email_writing_queue: no service-role token in GUC or vault — skipping';
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.invoke_email_writing_queue() from public;
grant execute on function public.invoke_email_writing_queue() to service_role;

do $$ begin
  perform cron.unschedule('invoke-email-writing-queue');
exception when others then null;
end $$;

-- Every minute. process-email-writing-queue has BATCH_SIZE=5 internally,
-- so a backlog of N items takes ceil(N/5) minutes to drain via cron alone;
-- the client-side trigger continues to provide instant turnaround for the
-- common case where the user keeps the tab open.
select cron.schedule(
  'invoke-email-writing-queue',
  '* * * * *',
  $$select public.invoke_email_writing_queue();$$
);

comment on function public.invoke_email_writing_queue is
  'pg_cron backstop for AI email-writing queue. Drains email_sequence_run_items pending/writing rows that the client-side trigger missed.';
