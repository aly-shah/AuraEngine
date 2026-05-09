// supabase/functions/verify-domain/index.ts
//
// Phase 4.6.b — DNS verification for workspace_domains rows.
//
//   POST /functions/v1/verify-domain
//   body: { domain_id: "<uuid>" }
//   Auth: Supabase user JWT (must be a member of the workspace owning the domain)
//
// Verifies one of the following DNS proofs:
//   1. TXT  _scaliyo-verify.<domain>  contains the verification_token
//   2. CNAME <domain>                 points at app.scaliyo.com
//
// Uses DNS-over-HTTPS to Cloudflare's resolver — no shell-level DNS access
// needed in the edge runtime. Marks the domain row verified or failed.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const APEX_TARGETS = ["app.scaliyo.com", "scaliyo.com"];

interface DohAnswer { name: string; type: number; data: string; }
interface DohResponse { Status: number; Answer?: DohAnswer[]; }

async function dohQuery(name: string, type: "TXT" | "CNAME"): Promise<DohResponse> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const r = await fetch(url, { headers: { Accept: "application/dns-json" } });
  if (!r.ok) throw new Error(`DoH ${type} ${name} -> HTTP ${r.status}`);
  return await r.json();
}

function stripQuotes(s: string): string {
  return s.replace(/^"+|"+$/g, "");
}

function jsonResponse(b: unknown, status: number, h: Record<string, string>): Response {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...h, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization" }, 401, corsHeaders);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: userRes, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !userRes?.user) return jsonResponse({ error: "Invalid token" }, 401, corsHeaders);
  const userId = userRes.user.id;

  const { domain_id } = await req.json().catch(() => ({} as { domain_id?: string }));
  if (!domain_id || typeof domain_id !== "string") {
    return jsonResponse({ error: "domain_id required" }, 400, corsHeaders);
  }

  // Authorise: caller must be a member of the workspace that owns this domain.
  const { data: row, error: rowErr } = await admin
    .from("workspace_domains")
    .select("id, workspace_id, domain, verification_token")
    .eq("id", domain_id)
    .maybeSingle();
  if (rowErr || !row) return jsonResponse({ error: "Domain not found" }, 404, corsHeaders);

  const { data: membership } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return jsonResponse({ error: "Forbidden" }, 403, corsHeaders);

  // ── Run the two DNS checks in parallel ──
  const txtName = `_scaliyo-verify.${row.domain}`;
  const [txtResult, cnameResult] = await Promise.allSettled([
    dohQuery(txtName, "TXT"),
    dohQuery(row.domain, "CNAME"),
  ]);

  // TXT proof
  let txtMatched = false;
  let txtSeen: string[] = [];
  if (txtResult.status === "fulfilled" && txtResult.value.Answer) {
    txtSeen = txtResult.value.Answer.filter((a) => a.type === 16).map((a) => stripQuotes(a.data));
    txtMatched = txtSeen.includes(row.verification_token);
  }

  // CNAME proof
  let cnameMatched = false;
  let cnameSeen: string[] = [];
  if (cnameResult.status === "fulfilled" && cnameResult.value.Answer) {
    cnameSeen = cnameResult.value.Answer
      .filter((a) => a.type === 5)
      .map((a) => a.data.replace(/\.$/, "").toLowerCase());
    cnameMatched = cnameSeen.some((c) => APEX_TARGETS.includes(c));
  }

  if (txtMatched || cnameMatched) {
    await admin.rpc("mark_domain_verified", { p_domain_id: domain_id });
    return jsonResponse({
      verified: true,
      method:   txtMatched ? "txt" : "cname",
      txt_seen:   txtSeen,
      cname_seen: cnameSeen,
    }, 200, corsHeaders);
  }

  const why =
    txtResult.status === "rejected" && cnameResult.status === "rejected"
      ? `DNS lookup failed: TXT=${(txtResult.reason as Error).message}; CNAME=${(cnameResult.reason as Error).message}`
      : `Neither proof found. TXT seen: [${txtSeen.join(", ") || "none"}]; CNAME seen: [${cnameSeen.join(", ") || "none"}]`;

  await admin.rpc("mark_domain_failed", { p_domain_id: domain_id, p_error: why });

  return jsonResponse({
    verified: false,
    error:    why,
    expected_txt:   { name: txtName,    value: row.verification_token },
    expected_cname: { name: row.domain, value: APEX_TARGETS[0] },
  }, 200, corsHeaders);
});
