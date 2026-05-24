// supabase/functions/_shared/auth.ts
//
// Shared helpers for the dual service-role-token regime.
//
// Project migrated to the new sb_secret_* service-role key (auto-bound to
// SUPABASE_SERVICE_ROLE_KEY at edge-fn runtime), but pg_cron callers still
// send the legacy JWT held in the Postgres vault. Functions invoked from
// cron must accept either, so the accepted-token list is the union.
//
// Two checks are exposed:
//   - isServiceRoleToken(t)  Strict: t equals one of the configured tokens.
//                            Default for service-role-only endpoints.
//   - isServiceRoleJwt(t)    Permissive: also accepts any JWT whose payload
//                            claims role="service_role". Use only where the
//                            handler enforces owner_id / workspace_id from
//                            the body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const LEGACY_SERVICE_ROLE_KEY = Deno.env.get("LEGACY_SERVICE_ROLE_KEY") ?? "";

export const ACCEPTED_SERVICE_TOKENS: readonly string[] = [
  SUPABASE_SERVICE_ROLE_KEY,
  LEGACY_SERVICE_ROLE_KEY,
].filter(Boolean);

export function isServiceRoleToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return ACCEPTED_SERVICE_TOKENS.includes(token);
}

export function isServiceRoleJwt(token: string | null | undefined): boolean {
  if (!token) return false;
  if (isServiceRoleToken(token)) return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

export function bearerToken(req: Request): string {
  const h = req.headers.get("Authorization") ?? "";
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export function userClient(userJwt: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}
