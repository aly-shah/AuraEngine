// supabase/functions/v1-leads/index.ts
//
// Phase 4.1 (read) + 4.2 (write) — Public REST API endpoint: leads.
//
//   GET   /functions/v1/v1-leads          (scope: leads.read)
//   POST  /functions/v1/v1-leads          (scope: leads.write, optional Idempotency-Key header)
//
// Workspace scope is derived from the API key — no workspace_id body
// or query param is honored.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateApiKey, adminClient, type ApiAuth } from "../_shared/api-auth.ts";

const COLUMNS = [
  "id", "first_name", "last_name", "primary_email", "primary_phone",
  "company", "title", "industry", "company_size", "linkedin_url",
  "location", "source", "score", "status", "insights",
  "last_activity", "created_at", "updated_at",
].join(",");

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const ALLOWED_STATUSES = new Set(["New", "Contacted", "Qualified", "Converted", "Lost"]);

const ALLOWED_LEAD_FIELDS = new Set<keyof Record<string, unknown>>([
  "first_name", "last_name", "primary_email", "primary_phone",
  "company", "title", "industry", "company_size", "linkedin_url",
  "location", "source", "score", "status", "insights",
  "custom_fields",
] as const);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── GET handler ─────────────────────────────────────────────────────────

async function handleGet(
  req: Request,
  auth: ApiAuth,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(MAX_LIMIT, limitRaw) : DEFAULT_LIMIT;
  const cursor = url.searchParams.get("cursor");
  const statusFilter = url.searchParams.get("status");

  const admin = adminClient();
  let q = admin
    .from("leads")
    .select(COLUMNS)
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("created_at", cursor);
  if (statusFilter) q = q.eq("status", statusFilter);

  const { data, error } = await q;
  if (error) {
    console.error("[v1-leads GET] query error:", error.message);
    return jsonResponse({ error: "Query failed", code: "query_failed" }, 500, corsHeaders);
  }
  const rows = data ?? [];
  const has_more = rows.length > limit;
  const result = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more
    ? (result[result.length - 1] as { created_at: string }).created_at
    : null;

  return jsonResponse({ data: result, next_cursor, has_more, limit }, 200, corsHeaders);
}

// ── POST handler with idempotency ───────────────────────────────────────

async function handlePost(
  req: Request,
  auth: ApiAuth,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // Read body once (we need it for both validation and idempotency hash).
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return jsonResponse({ error: "Failed to read body", code: "bad_request" }, 400, corsHeaders);
  }
  if (!bodyText) {
    return jsonResponse({ error: "Empty body", code: "bad_request" }, 400, corsHeaders);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonResponse({ error: "Invalid JSON", code: "bad_request" }, 400, corsHeaders);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ error: "Body must be a JSON object", code: "bad_request" }, 400, corsHeaders);
  }

  // Validation: at least one identifier.
  const email    = typeof body.primary_email === "string" ? body.primary_email.trim().toLowerCase() : null;
  const phone    = typeof body.primary_phone === "string" ? body.primary_phone.trim() : null;
  const linkedin = typeof body.linkedin_url   === "string" ? body.linkedin_url.trim() : null;
  if (!email && !phone && !linkedin) {
    return jsonResponse({
      error: "At least one of primary_email, primary_phone, linkedin_url is required",
      code: "missing_identifier",
    }, 400, corsHeaders);
  }

  // Validate enum-shaped fields.
  if (body.status !== undefined && !ALLOWED_STATUSES.has(String(body.status))) {
    return jsonResponse({
      error: `status must be one of ${[...ALLOWED_STATUSES].join(", ")}`,
      code: "invalid_status",
    }, 400, corsHeaders);
  }
  if (body.score !== undefined) {
    const s = Number(body.score);
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      return jsonResponse({ error: "score must be a number 0..100", code: "invalid_score" }, 400, corsHeaders);
    }
    body.score = Math.round(s);
  }

  // ── Idempotency check ──
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const requestHash = await sha256Hex(bodyText);
  const admin = adminClient();

  if (idempotencyKey) {
    const { data: cached } = await admin
      .from("api_idempotency")
      .select("request_hash, response_status, response_body")
      .eq("workspace_id", auth.workspaceId)
      .eq("key", idempotencyKey)
      .maybeSingle();
    if (cached) {
      if (cached.request_hash !== requestHash) {
        return jsonResponse({
          error: "Idempotency-Key was reused with a different request body",
          code: "idempotency_conflict",
        }, 409, corsHeaders);
      }
      // Cache hit — replay the original response.
      return new Response(JSON.stringify(cached.response_body), {
        status: cached.response_status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Scaliyo-Idempotent-Replay": "true" },
      });
    }
  }

  // ── Build insert row ──
  const row: Record<string, unknown> = {
    workspace_id: auth.workspaceId,
    client_id:    auth.workspaceId,   // legacy column still NOT NULL on leads
    primary_email: email,
    primary_phone: phone,
    linkedin_url:  linkedin,
  };
  for (const key of [
    "first_name", "last_name", "company", "title", "industry",
    "company_size", "location", "source", "score", "status", "insights",
    "custom_fields",
  ]) {
    if (body[key] !== undefined) row[key] = body[key];
  }
  if (row.score === undefined) row.score = 0;
  if (row.status === undefined) row.status = "New";

  const { data: inserted, error: insertError } = await admin
    .from("leads")
    .insert(row)
    .select(COLUMNS)
    .single();

  if (insertError) {
    console.error("[v1-leads POST] insert error:", insertError.message);
    return jsonResponse({
      error: insertError.message.includes("duplicate") ? "Conflicting lead" : "Insert failed",
      code: insertError.message.includes("duplicate") ? "conflict" : "insert_failed",
    }, insertError.message.includes("duplicate") ? 409 : 500, corsHeaders);
  }

  const responseBody = { data: inserted };
  const responseStatus = 201;

  // Persist idempotency entry (fire-and-forget — failure mustn't block the create).
  if (idempotencyKey) {
    admin.from("api_idempotency").insert({
      workspace_id:    auth.workspaceId,
      key:             idempotencyKey,
      api_key_id:      auth.apiKeyId,
      endpoint:        "POST /v1-leads",
      request_hash:    requestHash,
      response_status: responseStatus,
      response_body:   responseBody,
    }).then(({ error }) => {
      if (error) console.warn("[v1-leads POST] idempotency persist failed:", error.message);
    });
  }

  return jsonResponse(responseBody, responseStatus, corsHeaders);
}

// ── PATCH handler (partial update by ?id=<uuid>) ────────────────────────

async function handlePatch(
  req: Request,
  auth: ApiAuth,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonResponse({ error: "?id=<uuid> required", code: "missing_id" }, 400, corsHeaders);
  }

  let bodyText: string;
  try { bodyText = await req.text(); } catch { return jsonResponse({ error: "Failed to read body", code: "bad_request" }, 400, corsHeaders); }
  if (!bodyText) return jsonResponse({ error: "Empty body", code: "bad_request" }, 400, corsHeaders);

  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); } catch { return jsonResponse({ error: "Invalid JSON", code: "bad_request" }, 400, corsHeaders); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ error: "Body must be a JSON object", code: "bad_request" }, 400, corsHeaders);
  }

  // Build update payload from allowed fields only.
  const patch: Record<string, unknown> = {};
  const updatable = [
    "first_name", "last_name", "primary_email", "primary_phone",
    "company", "title", "industry", "company_size", "linkedin_url",
    "location", "source", "score", "status", "insights", "custom_fields",
  ];
  for (const k of updatable) if (body[k] !== undefined) patch[k] = body[k];

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: "No updatable fields provided", code: "no_fields" }, 400, corsHeaders);
  }
  if (patch.status !== undefined && !ALLOWED_STATUSES.has(String(patch.status))) {
    return jsonResponse({
      error: `status must be one of ${[...ALLOWED_STATUSES].join(", ")}`,
      code: "invalid_status",
    }, 400, corsHeaders);
  }
  if (patch.score !== undefined) {
    const s = Number(patch.score);
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      return jsonResponse({ error: "score must be 0..100", code: "invalid_score" }, 400, corsHeaders);
    }
    patch.score = Math.round(s);
  }
  if (typeof patch.primary_email === "string") {
    patch.primary_email = patch.primary_email.trim().toLowerCase();
  }

  // Idempotency check (same shape as POST).
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const requestHash = await sha256Hex(`PATCH:${id}:${bodyText}`);
  const admin = adminClient();

  if (idempotencyKey) {
    const { data: cached } = await admin
      .from("api_idempotency")
      .select("request_hash, response_status, response_body")
      .eq("workspace_id", auth.workspaceId)
      .eq("key", idempotencyKey)
      .maybeSingle();
    if (cached) {
      if (cached.request_hash !== requestHash) {
        return jsonResponse({
          error: "Idempotency-Key was reused with a different request",
          code: "idempotency_conflict",
        }, 409, corsHeaders);
      }
      return new Response(JSON.stringify(cached.response_body), {
        status: cached.response_status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Scaliyo-Idempotent-Replay": "true" },
      });
    }
  }

  // Apply update with workspace_id + id constraint so an attacker can't
  // patch another workspace's lead by guessing a UUID.
  const { data: updated, error: updateErr } = await admin
    .from("leads")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select(COLUMNS)
    .single();

  if (updateErr) {
    console.error("[v1-leads PATCH] update error:", updateErr.message);
    return jsonResponse({ error: "Update failed", code: "update_failed" }, 500, corsHeaders);
  }
  if (!updated) {
    return jsonResponse({ error: "Lead not found", code: "not_found" }, 404, corsHeaders);
  }

  const responseBody = { data: updated };
  const responseStatus = 200;

  if (idempotencyKey) {
    admin.from("api_idempotency").insert({
      workspace_id:    auth.workspaceId,
      key:             idempotencyKey,
      api_key_id:      auth.apiKeyId,
      endpoint:        "PATCH /v1-leads",
      request_hash:    requestHash,
      response_status: responseStatus,
      response_body:   responseBody,
    }).then(({ error }) => {
      if (error) console.warn("[v1-leads PATCH] idempotency persist failed:", error.message);
    });
  }

  return jsonResponse(responseBody, responseStatus, corsHeaders);
}

// ── Entry point ─────────────────────────────────────────────────────────

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "GET") {
    const auth = await authenticateApiKey(req, { requiredScope: "leads.read", corsHeaders });
    if (!auth.ok) return auth.response;
    return handleGet(req, auth.auth, corsHeaders);
  }
  if (req.method === "POST") {
    const auth = await authenticateApiKey(req, { requiredScope: "leads.write", corsHeaders });
    if (!auth.ok) return auth.response;
    return handlePost(req, auth.auth, corsHeaders);
  }
  if (req.method === "PATCH") {
    const auth = await authenticateApiKey(req, { requiredScope: "leads.write", corsHeaders });
    if (!auth.ok) return auth.response;
    return handlePatch(req, auth.auth, corsHeaders);
  }
  return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405, corsHeaders);
});
