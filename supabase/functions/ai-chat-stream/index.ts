import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";
import { getCorsHeaders, handleCors } from "../_shared/cors.ts";
import { adminClient } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL_NAME = "gemini-3-flash-preview";

// Cluster-wide rate limit (20 req/min per user) via Postgres consume_ai_rate_limit.
// Tighter than gemini-proxy because streaming sessions are heavier per request.
const RATE_LIMIT_PER_MIN = 20;

async function checkRateLimit(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ allowed: boolean; resetAt: string | null }> {
  try {
    const { data, error } = await admin.rpc("consume_ai_rate_limit", {
      p_user_id: userId,
      p_max_per_min: RATE_LIMIT_PER_MIN,
    });
    if (error) {
      console.warn("[ai-chat-stream] rate-limit RPC error, allowing:", error.message);
      return { allowed: true, resetAt: null };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      allowed: row?.allowed !== false,
      resetAt: (row?.reset_at as string | undefined) ?? null,
    };
  } catch (e) {
    console.warn("[ai-chat-stream] rate-limit threw, allowing:", (e as Error).message);
    return { allowed: true, resetAt: null };
  }
}

const MODE_SYSTEM_INSTRUCTIONS: Record<string, string> = {
  analyst:
    "You are a senior data analyst for a B2B sales pipeline. Cite specific lead names, scores, and percentages. Use markdown tables when comparing data. Be precise and data-driven.",
  strategist:
    "You are a sales strategist for a B2B pipeline. Create actionable plans and reference leads by name. Always end with a clear next step the user can take immediately.",
  coach:
    "You are a sales coach reviewing a B2B pipeline. Give honest, constructive feedback. Identify strengths and weaknesses from the actual data. Be encouraging but direct.",
  creative:
    "You are a content specialist for B2B sales outreach. Write personalized content referencing specific lead details (name, company, insights). Never produce generic templates — every piece must be tailored to the data provided.",
};

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const corsHeaders = getCorsHeaders(req);

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = adminClient();
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limit: cluster-wide via Postgres
    const rl = await checkRateLimit(supabaseAdmin, user.id);
    if (!rl.allowed) {
      const retryAfter = rl.resetAt
        ? Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))
        : 60;
      return new Response(
        JSON.stringify({
          error: `Rate limit exceeded (${RATE_LIMIT_PER_MIN} req/min). Please wait a moment.`,
          reset_at: rl.resetAt,
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfter) },
        }
      );
    }

    const body = await req.json();
    const {
      mode = "analyst",
      prompt,
      history = [],
      leadContext = "",
      pipelineStats = "",
      businessContext = "",
      threadId,
      messageId,
    } = body as {
      mode: string;
      prompt: string;
      history: { role: string; content: string }[];
      leadContext: string;
      pipelineStats: string;
      businessContext: string;
      threadId?: string;
      messageId?: string;
    };

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Input length guardrails
    if (prompt.length > 20_000) {
      return new Response(
        JSON.stringify({ error: "Prompt too long (max 20,000 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (leadContext.length > 50_000 || pipelineStats.length > 10_000) {
      return new Response(
        JSON.stringify({ error: "Context data too large" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build Gemini request ──
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const systemInstruction =
      (MODE_SYSTEM_INSTRUCTIONS[mode] || MODE_SYSTEM_INSTRUCTIONS.analyst) +
      (businessContext ? `\n\nBUSINESS CONTEXT:\n${businessContext}` : "");

    const contextBlock = `${pipelineStats}\n\nTOP LEADS:\n${leadContext || "No leads in pipeline."}`;

    const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
    for (const msg of (history || []).slice(-10)) {
      contents.push({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      });
    }
    contents.push({
      role: "user",
      parts: [{ text: `${contextBlock}\n\nUSER REQUEST:\n${prompt}` }],
    });

    const genConfig = {
      systemInstruction,
      temperature: mode === "creative" ? 0.85 : 0.7,
      topP: 0.9,
      topK: 40,
    };

    // ── Stream via SSE ──
    const encoder = new TextEncoder();
    let totalTokens = 0;
    let fullText = "";
    const startTime = Date.now();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          const stream = await ai.models.generateContentStream({
            model: MODEL_NAME,
            contents,
            config: genConfig,
          });

          for await (const chunk of stream) {
            const text = chunk.text || "";
            if (!text) continue;
            fullText += text;

            const data = JSON.stringify({ type: "chunk", text, accumulated: fullText.length });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Final event with metadata
          totalTokens = Math.ceil(fullText.length / 4); // rough estimate
          const latencyMs = Date.now() - startTime;
          const done = JSON.stringify({
            type: "done",
            totalLength: fullText.length,
            tokensUsed: totalTokens,
            latencyMs,
          });
          controller.enqueue(encoder.encode(`data: ${done}\n\n`));

          // ── Persist final message to DB if threadId provided ──
          if (threadId && messageId) {
            try {
              await supabaseAdmin
                .from("ai_messages")
                .update({
                  content: fullText,
                  status: "complete",
                  tokens_used: totalTokens,
                  latency_ms: latencyMs,
                  finished_at: new Date().toISOString(),
                })
                .eq("id", messageId);

              // Update thread's last message timestamp
              await supabaseAdmin
                .from("ai_threads")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", threadId);
            } catch (dbErr) {
              console.error("Failed to persist AI message:", dbErr);
            }
          }

          controller.close();
        } catch (err) {
          const errorData = JSON.stringify({
            type: "error",
            message: (err as Error).message || "Generation failed",
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("ai-chat-stream error:", err);
    return new Response(
      JSON.stringify({ error: `Internal error: ${(err as Error).message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
