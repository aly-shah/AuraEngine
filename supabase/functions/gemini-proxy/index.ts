// supabase/functions/gemini-proxy/index.ts
//
// Generic Gemini API proxy. Accepts the same `{ model, contents, config }`
// payload the @google/genai SDK sends to `ai.models.generateContent(...)` and
// `ai.models.generateContentStream(...)`, forwards it server-side with the
// GEMINI_API_KEY, and returns the response in the shape the client SDK would
// have produced. Also handles Imagen via `kind: "images"` (mirrors
// `ai.models.generateImages(...)`).
//
// This closes the long-standing leak of GEMINI_API_KEY into the browser bundle
// (previously read via `process.env.API_KEY` at build time). The key never
// leaves the Edge Function environment.
//
// Protocol:
//   POST /functions/v1/gemini-proxy
//   Authorization: Bearer <supabase_user_jwt>
//   Body (text): { kind?: "content", model, contents, config, stream?: boolean }
//   Body (image): { kind: "images", model, prompt, config }
//
//   Text non-streaming: → 200 application/json  { text, candidates, usageMetadata, ... }
//   Text streaming:     → 200 text/event-stream  (SSE; each event is a JSON chunk)
//   Image:              → 200 application/json  { generatedImages: [{ image: { imageBytes } }] }
//
// Deploy: supabase functions deploy gemini-proxy

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

// In-memory rate limiting: 60 req/min per user. Matches the Nginx zone.
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return true;
}

interface ProxyRequest {
  model: string;
  contents?: unknown;
  prompt?: string;
  config?: Record<string, unknown>;
  stream?: boolean;
  kind?: "content" | "images";
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const corsHeaders = getCorsHeaders(req);

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: "GEMINI_API_KEY not configured" }, 500, corsHeaders);
  }

  // ── Auth ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401, corsHeaders);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401, corsHeaders);
  }

  // ── Rate limit ──
  if (!checkRateLimit(user.id)) {
    return jsonResponse(
      { error: "Rate limit exceeded. Please slow down." },
      429,
      corsHeaders,
    );
  }

  // ── Parse body ──
  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, corsHeaders);
  }

  const kind = body.kind ?? "content";

  if (!body.model) {
    return jsonResponse({ error: "Missing required field: model" }, 400, corsHeaders);
  }
  if (kind === "content" && body.contents === undefined) {
    return jsonResponse({ error: "Missing required field: contents" }, 400, corsHeaders);
  }
  if (kind === "images" && !body.prompt) {
    return jsonResponse({ error: "Missing required field: prompt" }, 400, corsHeaders);
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    // ── Image generation (Imagen) ──
    if (kind === "images") {
      const response = await ai.models.generateImages({
        model: body.model,
        prompt: body.prompt as string,
        config: body.config as never,
      });
      return jsonResponse(
        { generatedImages: response.generatedImages ?? [] },
        200,
        corsHeaders,
      );
    }

    // ── Streaming ──
    if (body.stream) {
      const stream = await ai.models.generateContentStream({
        model: body.model,
        contents: body.contents as never,
        config: body.config as never,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const payload = JSON.stringify({
                text: chunk.text ?? "",
                candidates: chunk.candidates ?? [],
                usageMetadata: chunk.usageMetadata ?? null,
              });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // ── Non-streaming ──
    const response = await ai.models.generateContent({
      model: body.model,
      contents: body.contents as never,
      config: body.config as never,
    });

    return jsonResponse(
      {
        text: response.text ?? "",
        candidates: response.candidates ?? [],
        usageMetadata: response.usageMetadata ?? null,
      },
      200,
      corsHeaders,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[gemini-proxy] upstream error:", message);
    return jsonResponse({ error: `Gemini API error: ${message}` }, 502, corsHeaders);
  }
});
