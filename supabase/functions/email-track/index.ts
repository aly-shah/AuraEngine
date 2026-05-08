import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const FALLBACK_URL = Deno.env.get("TRACKING_FALLBACK_URL") ?? "https://example.com";

// 1x1 transparent PNG (68 bytes)
const PIXEL_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
  0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// Bot detection UA substrings
const BOT_UA_PATTERNS = [
  "googlebot", "bingbot", "slurp", "duckduckbot", "baiduspider",
  "yandexbot", "facebookexternalhit", "twitterbot", "linkedinbot",
  "whatsapp", "telegrambot", "discordbot", "applebot", "semrushbot",
  "ahrefsbot", "mj12bot", "dotbot", "petalbot", "bytespider",
];

const APPLE_PRIVACY_PATTERNS = ["mozilla/5.0 (macintosh", "apple mail"];

// In-memory dedup cache: key → timestamp
const dedupCache = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_ENTRIES = 10_000;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  // Cleanup if cache is too large
  if (dedupCache.size > DEDUP_MAX_ENTRIES) {
    for (const [k, ts] of dedupCache) {
      if (now - ts > DEDUP_WINDOW_MS) dedupCache.delete(k);
    }
  }
  const last = dedupCache.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  dedupCache.set(key, now);
  return false;
}

function detectBot(ua: string): { isBot: boolean; isApplePrivacy: boolean } {
  const lower = ua.toLowerCase();
  const isBot = BOT_UA_PATTERNS.some((p) => lower.includes(p));
  const isApplePrivacy = APPLE_PRIVACY_PATTERNS.some((p) => lower.includes(p));
  return { isBot, isApplePrivacy };
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // ── Open pixel: GET /t/p/:messageId.png ──
  // Path may include the edge function base prefix (e.g. /functions/v1/email-track/t/p/...)
  const pixelMatch = path.match(/\/t\/p\/([0-9a-f-]{36})\.png$/i);
  if (pixelMatch && req.method === "GET") {
    const messageId = pixelMatch[1];
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? "";
    const dedupKey = `open:${messageId}:${ip}:${ua.slice(0, 50)}`;

    // Fire-and-forget: record event asynchronously
    if (!isDuplicate(dedupKey)) {
      const { isBot, isApplePrivacy } = detectBot(ua);
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      supabaseAdmin.rpc("record_email_event", {
        p_message_id: messageId,
        p_event_type: "open",
        p_ip_address: ip,
        p_user_agent: ua,
        p_is_bot: isBot,
        p_is_apple_privacy: isApplePrivacy,
      }).then(({ error }) => {
        if (error) console.error("Open event error:", error.message);
      });
      // AI memory: append interaction to lead_memory (Phase 2.1 writer).
      // Fire-and-forget — failures cannot break email tracking.
      supabaseAdmin.rpc("log_lead_memory_email_event", {
        p_message_id: messageId,
        p_event_type: "open",
        p_is_bot: isBot,
        p_is_apple_privacy: isApplePrivacy,
      }).then(({ error }) => {
        if (error) console.warn("Open memory write skipped:", error.message);
      });
    }

    return new Response(PIXEL_PNG, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
      },
    });
  }

  // ── Click redirect: GET /t/c/:linkId ──
  const clickMatch = path.match(/\/t\/c\/([0-9a-f-]{36})$/i);
  if (clickMatch && req.method === "GET") {
    const linkId = clickMatch[1];
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = req.headers.get("user-agent") ?? "";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up destination URL
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("email_links")
      .select("id, message_id, destination_url")
      .eq("id", linkId)
      .single();

    if (linkErr || !link) {
      return new Response(null, {
        status: 302,
        headers: { Location: FALLBACK_URL },
      });
    }

    const dedupKey = `click:${linkId}:${ip}:${ua.slice(0, 50)}`;
    if (!isDuplicate(dedupKey)) {
      const { isBot, isApplePrivacy } = detectBot(ua);
      supabaseAdmin.rpc("record_email_event", {
        p_message_id: link.message_id,
        p_event_type: "click",
        p_link_id: linkId,
        p_ip_address: ip,
        p_user_agent: ua,
        p_is_bot: isBot,
        p_is_apple_privacy: isApplePrivacy,
      }).then(({ error }) => {
        if (error) console.error("Click event error:", error.message);
      });
      // AI memory: clicks are a stronger signal than opens. Fire-and-forget.
      supabaseAdmin.rpc("log_lead_memory_email_event", {
        p_message_id: link.message_id,
        p_event_type: "click",
        p_link_id: linkId,
        p_destination_url: link.destination_url,
        p_is_bot: isBot,
        p_is_apple_privacy: isApplePrivacy,
      }).then(({ error }) => {
        if (error) console.warn("Click memory write skipped:", error.message);
      });
    }

    return new Response(null, {
      status: 302,
      headers: { Location: link.destination_url },
    });
  }

  // ── Fallback ──
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
});
