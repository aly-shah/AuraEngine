-- ============================================================================
-- 20260510100000_webhook_dispatcher_cron.sql
-- ----------------------------------------------------------------------------
-- Phase 4.3 (cron) — auto-invoke webhook-dispatcher every minute via pg_net.
--
-- Replaces the no-op cron entry from migration 20260509300000 with a real
-- pg_net.http_post that calls the webhook-dispatcher edge function.
--
-- Auth: dispatcher requires SUPABASE_SERVICE_ROLE_KEY in the Authorization
-- header. We don't want to embed the key in this migration (which lives in
-- git), so we read it from supabase_vault. After applying this migration,
-- run ONCE in the SQL editor (or via setup script):
--
--     select vault.create_secret(
--       '<paste_your_service_role_key>',
--       'webhook_dispatcher_service_key'
--     );
--
-- Until that vault secret exists, the cron's Authorization header will be
-- "Bearer " (empty) and the dispatcher will reject with 401 — harmless;
-- delivery just doesn't happen until the secret is set.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Replace the no-op stub from 20260509300000.

do $$ begin
  perform cron.unschedule('webhook-dispatcher');
exception when others then null;
end $$;

-- Wrap the http_post in a security-definer function so the cron job
-- (postgres role) can read the vault secret without grant complications.

create or replace function public.invoke_webhook_dispatcher()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url    text := 'https://utvydxqiqedaaxmmpfpf.functions.supabase.co/webhook-dispatcher';
  v_token  text;
  v_req_id bigint;
begin
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'webhook_dispatcher_service_key'
  limit 1;

  if v_token is null or v_token = '' then
    -- Don't error — just log and skip. Lets the cron stay registered
    -- before the secret is provisioned.
    raise warning 'webhook_dispatcher_service_key vault secret missing — skipping';
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_token
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  ) into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.invoke_webhook_dispatcher() from public;
grant execute on function public.invoke_webhook_dispatcher() to postgres;

select cron.schedule(
  'webhook-dispatcher',
  '* * * * *',  -- every minute
  $$select public.invoke_webhook_dispatcher();$$
);

comment on function public.invoke_webhook_dispatcher is
  'Phase 4.3 cron — POSTs to webhook-dispatcher edge function with the service-role key from vault. Logs warning + skips when secret is missing.';
