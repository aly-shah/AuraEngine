// supabase/functions/webhook-dispatcher/index.ts
//
// Phase 4.3 — Outbound webhook dispatcher.
//
// Invokes per-tick (cron / external scheduler / manual) to drain
// webhook_deliveries.status='pending' rows. For each delivery:
//   1. Claim via claim_pending_webhook_deliveries (atomic, status='processing')
//   2. POST the payload to the endpoint's URL with headers:
//        Content-Type: application/json
//        X-Scaliyo-Signature: t=<unix>,v1=<hex hmac-sha256(t.body, secret)>
//        X-Scaliyo-Event:    <event_type>
//        X-Scaliyo-Delivery: <delivery id>
//        X-Scaliyo-Attempt:  <attempt count>
//   3. mark_webhook_delivery_result with success/failure
//      Success: HTTP 2xx within 8s
//      Failure: anything else (bumps attempt_count, sets next_attempt_at
//               via backoff schedule in the SQL function)
//
// Auth: service_role only — use the function URL with the service-role
// key as Authorization. NOT a public endpoint.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { adminClient, bearerToken, isServiceRoleToken } from "../_shared/auth.ts";

const BATCH_SIZE = 50;
const TIMEOUT_MS = 8_000;

interface PendingDelivery {
  delivery_id:    string;
  endpoint_id:    string;
  workspace_id:   string;
  url:            string;
  secret:         string;
  event_type:     string;
  payload:        unknown;
  attempt_count:  number;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deliver(d: PendingDelivery): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify({
    id:           d.delivery_id,
    event_type:   d.event_type,
    workspace_id: d.workspace_id,
    payload:      d.payload,
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = await hmacSha256Hex(d.secret, `${ts}.${body}`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(d.url, {
      method: "POST",
      headers: {
        "Content-Type":          "application/json",
        "X-Scaliyo-Signature":   `t=${ts},v1=${sig}`,
        "X-Scaliyo-Event":       d.event_type,
        "X-Scaliyo-Delivery":    d.delivery_id,
        "X-Scaliyo-Attempt":     String(d.attempt_count),
      },
      body,
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

serve(async (req) => {
  // Service-role only. Reject everything else with 401.
  if (!isServiceRoleToken(bearerToken(req))) {
    return new Response(JSON.stringify({ error: "service-role only" }), { status: 401 });
  }

  const admin = adminClient();

  const { data, error } = await admin.rpc("claim_pending_webhook_deliveries", {
    p_limit: BATCH_SIZE,
  });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const pending = (data ?? []) as PendingDelivery[];
  if (pending.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = await Promise.all(pending.map(async (d) => {
    const r = await deliver(d);
    await admin.rpc("mark_webhook_delivery_result", {
      p_delivery_id: d.delivery_id,
      p_succeeded:   r.ok,
      p_status_code: r.status ?? null,
      p_error:       r.error ?? null,
    });
    return r;
  }));

  const succeeded = results.filter((r) => r.ok).length;

  return new Response(JSON.stringify({
    processed: pending.length,
    succeeded,
    failed: pending.length - succeeded,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
