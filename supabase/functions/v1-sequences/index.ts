// supabase/functions/v1-sequences/index.ts — Phase 4.2
//
//   GET    /functions/v1/v1-sequences            scope: campaigns.read
//   POST   /functions/v1/v1-sequences            scope: campaigns.write
//   PATCH  /functions/v1/v1-sequences?id=<uuid>  scope: campaigns.write
//
// Creating a sequence ROW does not start a sequence run — that happens
// via the existing start-email-sequence-run edge function which writes
// to a different table and requires the AI writer queue. This API
// exposes the sequence-as-template surface only.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateApiKey, adminClient, type ApiAuth } from "../_shared/api-auth.ts";

const COLUMNS = "id,name,description,status,goal,tone,total_leads,total_sent,created_at,updated_at";
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const ALLOWED_STATUSES = new Set(["draft", "active", "paused", "completed", "archived"]);

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function jsonResponse(b: unknown, status: number, h: Record<string, string>): Response {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...h, "Content-Type": "application/json" },
  });
}

// ── GET ─────────────────────────────────────────────────────────────────

async function handleGet(req: Request, auth: ApiAuth, h: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(MAX_LIMIT, limitRaw) : DEFAULT_LIMIT;
  const cursor = url.searchParams.get("cursor");
  const statusFilter = url.searchParams.get("status");

  let q = adminClient()
    .from("email_sequences")
    .select(COLUMNS)
    .eq("workspace_id", auth.workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (cursor) q = q.lt("created_at", cursor);
  if (statusFilter) q = q.eq("status", statusFilter);

  const { data, error } = await q;
  if (error) return jsonResponse({ error: "Query failed", code: "query_failed" }, 500, h);
  const rows = data ?? [];
  const has_more = rows.length > limit;
  const result = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more ? (result[result.length - 1] as { created_at: string }).created_at : null;
  return jsonResponse({ data: result, next_cursor, has_more, limit }, 200, h);
}

// ── POST (create draft sequence) ────────────────────────────────────────

async function handlePost(req: Request, auth: ApiAuth, h: Record<string, string>): Promise<Response> {
  const bodyText = await req.text().catch(() => "");
  if (!bodyText) return jsonResponse({ error: "Empty body", code: "bad_request" }, 400, h);

  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); } catch { return jsonResponse({ error: "Invalid JSON", code: "bad_request" }, 400, h); }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ error: "Body must be a JSON object", code: "bad_request" }, 400, h);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonResponse({ error: "name is required", code: "missing_name" }, 400, h);

  if (body.status !== undefined && !ALLOWED_STATUSES.has(String(body.status))) {
    return jsonResponse({
      error: `status must be one of ${[...ALLOWED_STATUSES].join(", ")}`,
      code: "invalid_status",
    }, 400, h);
  }

  // Idempotency.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const requestHash = await sha256Hex(`POST:${bodyText}`);
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
          error: "Idempotency-Key reused with different request",
          code: "idempotency_conflict",
        }, 409, h);
      }
      return new Response(JSON.stringify(cached.response_body), {
        status: cached.response_status,
        headers: { ...h, "Content-Type": "application/json", "X-Scaliyo-Idempotent-Replay": "true" },
      });
    }
  }

  const row: Record<string, unknown> = {
    workspace_id: auth.workspaceId,
    created_by:   auth.apiKeyId,        // attribution: which API key created this draft
    name,
    description:  typeof body.description === "string" ? body.description : null,
    status:       typeof body.status      === "string" ? body.status      : "draft",
    goal:         typeof body.goal        === "string" ? body.goal        : null,
    tone:         typeof body.tone        === "string" ? body.tone        : "professional",
  };

  const { data: inserted, error: insertErr } = await admin
    .from("email_sequences")
    .insert(row)
    .select(COLUMNS)
    .single();

  if (insertErr) {
    console.error("[v1-sequences POST] insert error:", insertErr.message);
    return jsonResponse({ error: "Insert failed", code: "insert_failed" }, 500, h);
  }

  const responseBody = { data: inserted };
  const responseStatus = 201;

  if (idempotencyKey) {
    admin.from("api_idempotency").insert({
      workspace_id:    auth.workspaceId,
      key:             idempotencyKey,
      api_key_id:      auth.apiKeyId,
      endpoint:        "POST /v1-sequences",
      request_hash:    requestHash,
      response_status: responseStatus,
      response_body:   responseBody,
    }).then(({ error }) => {
      if (error) console.warn("[v1-sequences POST] idempotency persist failed:", error.message);
    });
  }

  return jsonResponse(responseBody, responseStatus, h);
}

// ── PATCH (?id=<uuid>) ──────────────────────────────────────────────────

async function handlePatch(req: Request, auth: ApiAuth, h: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return jsonResponse({ error: "?id=<uuid> required", code: "missing_id" }, 400, h);
  }

  const bodyText = await req.text().catch(() => "");
  if (!bodyText) return jsonResponse({ error: "Empty body", code: "bad_request" }, 400, h);

  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); } catch { return jsonResponse({ error: "Invalid JSON", code: "bad_request" }, 400, h); }

  const patch: Record<string, unknown> = {};
  for (const k of ["name", "description", "status", "goal", "tone"]) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: "No updatable fields provided", code: "no_fields" }, 400, h);
  }
  if (patch.status !== undefined && !ALLOWED_STATUSES.has(String(patch.status))) {
    return jsonResponse({
      error: `status must be one of ${[...ALLOWED_STATUSES].join(", ")}`,
      code: "invalid_status",
    }, 400, h);
  }

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
          error: "Idempotency-Key reused with different request",
          code: "idempotency_conflict",
        }, 409, h);
      }
      return new Response(JSON.stringify(cached.response_body), {
        status: cached.response_status,
        headers: { ...h, "Content-Type": "application/json", "X-Scaliyo-Idempotent-Replay": "true" },
      });
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from("email_sequences")
    .update(patch)
    .eq("id", id)
    .eq("workspace_id", auth.workspaceId)
    .select(COLUMNS)
    .single();

  if (updateErr) {
    console.error("[v1-sequences PATCH] update error:", updateErr.message);
    return jsonResponse({ error: "Update failed", code: "update_failed" }, 500, h);
  }
  if (!updated) return jsonResponse({ error: "Sequence not found", code: "not_found" }, 404, h);

  const responseBody = { data: updated };
  const responseStatus = 200;

  if (idempotencyKey) {
    admin.from("api_idempotency").insert({
      workspace_id:    auth.workspaceId,
      key:             idempotencyKey,
      api_key_id:      auth.apiKeyId,
      endpoint:        "PATCH /v1-sequences",
      request_hash:    requestHash,
      response_status: responseStatus,
      response_body:   responseBody,
    }).then(({ error }) => {
      if (error) console.warn("[v1-sequences PATCH] idempotency persist failed:", error.message);
    });
  }

  return jsonResponse(responseBody, responseStatus, h);
}

// ── Entry point ─────────────────────────────────────────────────────────

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "GET") {
    const auth = await authenticateApiKey(req, { requiredScope: "campaigns.read", corsHeaders });
    if (!auth.ok) return auth.response;
    return handleGet(req, auth.auth, corsHeaders);
  }
  if (req.method === "POST") {
    const auth = await authenticateApiKey(req, { requiredScope: "campaigns.write", corsHeaders });
    if (!auth.ok) return auth.response;
    return handlePost(req, auth.auth, corsHeaders);
  }
  if (req.method === "PATCH") {
    const auth = await authenticateApiKey(req, { requiredScope: "campaigns.write", corsHeaders });
    if (!auth.ok) return auth.response;
    return handlePatch(req, auth.auth, corsHeaders);
  }
  return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405, corsHeaders);
});
