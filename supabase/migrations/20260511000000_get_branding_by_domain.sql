-- ============================================================================
-- 20260511000000_get_branding_by_domain.sql
-- ----------------------------------------------------------------------------
-- Phase 4.6.b — pre-login branding by Host header.
--
-- The SPA needs to render a customer's logo/colors on the auth page when
-- served from their vanity domain (e.g. app.acme.com), before any user
-- has authenticated. Branding lives in workspace_branding which is
-- workspace_members-scoped — anon can't read it directly.
--
-- This RPC is SECURITY DEFINER and grants EXECUTE to anon. It returns
-- ONLY for domains that are both verified AND TLS-provisioned, which
-- means the request is genuinely arriving at a customer-controlled,
-- customer-paid-for, public-facing endpoint. Branding fields exposed
-- (logo URL, color tokens, product name, support email) are
-- intentionally public — they will be rendered to anyone visiting
-- the domain anyway.
--
-- Security note: the function deliberately does NOT expose anything
-- beyond the branding columns. workspace_id, owner identity, etc. are
-- not returned.
-- ============================================================================

create or replace function public.get_branding_by_domain(p_domain text)
returns table (
  logo_url         text,
  favicon_url      text,
  primary_color    text,
  accent_color     text,
  background_color text,
  product_name     text,
  support_email    text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    wb.logo_url,
    wb.favicon_url,
    wb.primary_color,
    wb.accent_color,
    wb.background_color,
    wb.product_name,
    wb.support_email
  from public.workspace_domains wd
  join public.workspace_branding wb on wb.workspace_id = wd.workspace_id
  where lower(wd.domain)        = lower(p_domain)
    and wd.status               = 'verified'
    and wd.provisioned_at is not null
  limit 1;
$$;

revoke all on function public.get_branding_by_domain(text) from public;
grant execute on function public.get_branding_by_domain(text) to anon, authenticated, service_role;

comment on function public.get_branding_by_domain is
  'Phase 4.6.b — anon-callable. Returns workspace branding for a vanity domain that is both verified and TLS-provisioned. Used by the SPA to render branded auth/landing pages before login. Exposes ONLY the public-facing branding columns.';
