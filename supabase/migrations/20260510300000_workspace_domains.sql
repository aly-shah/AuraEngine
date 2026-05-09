-- ============================================================================
-- 20260510300000_workspace_domains.sql
-- ----------------------------------------------------------------------------
-- Phase 4.6.b (foundation) — workspace vanity domains.
--
-- Schema + verification flow only. Per-tenant TLS via Let's Encrypt and
-- Nginx server-block templating are deployment-infra work that lives in
-- the next session — but the data model has to land first so the UI and
-- verification edge function can be built against it.
--
-- Verification flow:
--   1. Customer adds a domain  (status='pending', verification_token minted)
--   2. UI shows them the DNS record they must add:
--        TXT  _scaliyo-verify.<domain>  "<verification_token>"
--      OR
--        CNAME <domain>  app.scaliyo.com   (acceptable proof for any of
--                                           the variants we'll accept)
--   3. They click "Verify" — verify-domain edge function does a DNS
--      lookup, marks status='verified', sets verified_at.
--   4. Once verified, the SPA + Nginx will serve their domain
--      (next session — needs TLS automation).
-- ============================================================================

create table if not exists public.workspace_domains (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  domain              text not null,
  verification_token  text not null,
  status              text not null default 'pending'
                      check (status in ('pending','verified','failed','expired')),
  is_primary          boolean not null default false,
  verified_at         timestamptz,
  last_check_at       timestamptz,
  last_check_error    text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  -- Domain syntax: lowercase letters/digits/hyphen + dot, no leading/trailing
  -- hyphen, max length per RFC. Loose check; full validation happens in
  -- the edge function with a real DNS lookup.
  constraint workspace_domains_domain_format
    check (domain ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

-- One workspace can register a domain only once.
create unique index if not exists idx_workspace_domains_unique
  on public.workspace_domains (lower(domain));

create unique index if not exists idx_workspace_domains_one_primary
  on public.workspace_domains (workspace_id) where is_primary = true;

create index if not exists idx_workspace_domains_workspace
  on public.workspace_domains (workspace_id, status);

alter table public.workspace_domains enable row level security;

create policy workspace_domains_select on public.workspace_domains
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy workspace_domains_insert on public.workspace_domains
  for insert with check (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy workspace_domains_update on public.workspace_domains
  for update using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

create policy workspace_domains_delete on public.workspace_domains
  for delete using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );

-- ── add_workspace_domain(workspace, domain) ────────────────────────────
--
-- Mints the verification_token server-side so the row insert has a
-- value the UI can immediately surface. Returns the row.

create or replace function public.add_workspace_domain(
  p_workspace_id uuid,
  p_domain       text
) returns public.workspace_domains
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_row   public.workspace_domains%rowtype;
begin
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  ) then
    raise exception 'forbidden: caller not in workspace %', p_workspace_id;
  end if;

  -- Token: 32 random hex chars (16 bytes from gen_random_bytes).
  v_token := encode(gen_random_bytes(16), 'hex');

  insert into public.workspace_domains (workspace_id, domain, verification_token, created_by)
  values (p_workspace_id, lower(trim(p_domain)), v_token, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_workspace_domain(uuid, text) from public;
grant execute on function public.add_workspace_domain(uuid, text) to authenticated;

-- ── mark_domain_verified / mark_domain_failed ─────────────────────────
--
-- Called by the verify-domain edge function after the DNS lookup.

create or replace function public.mark_domain_verified(
  p_domain_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_domains
     set status = 'verified',
         verified_at = now(),
         last_check_at = now(),
         last_check_error = null
   where id = p_domain_id;
end;
$$;

revoke all on function public.mark_domain_verified(uuid) from public;
grant execute on function public.mark_domain_verified(uuid) to service_role;

create or replace function public.mark_domain_failed(
  p_domain_id uuid,
  p_error     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_domains
     set status = case when verified_at is not null then 'verified' else 'failed' end,
         last_check_at = now(),
         last_check_error = p_error
   where id = p_domain_id;
end;
$$;

revoke all on function public.mark_domain_failed(uuid, text) from public;
grant execute on function public.mark_domain_failed(uuid, text) to service_role;

comment on table public.workspace_domains is
  'Phase 4.6.b — vanity domain registrations. Verification by DNS TXT record on _scaliyo-verify.<domain> or CNAME pointing at app.scaliyo.com. TLS provisioning and nginx server-block templating live in the next session.';
