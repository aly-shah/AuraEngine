import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAILCHIMP_WEBHOOK_SECRET = Deno.env.get("MAILCHIMP_WEBHOOK_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

// Verify Mailchimp webhook signature (HMAC-SHA256)
async function verifyMailchimpSignature(
  payload: string,
  sigHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!secret || !sigHeader) return !secret; // skip only if secret not configured
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload)
    );
    const computed = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return computed === sigHeader;
  } catch {
    return false;
  }
}

// Map Mailchimp webhook types to our event types
const EVENT_MAP: Record<string, string> = {
  send: "delivered",
  open: "open",
  click: "click",
  hard_bounce: "bounced",
  soft_bounce: "bounced",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // GET — Mailchimp URL validation (must return 200)
  if (req.method === "GET") {
    return new Response("ok", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verify webhook signature when secret is configured
  if (MAILCHIMP_WEBHOOK_SECRET) {
    const rawBody = await req.clone().text();
    const sigHeader = req.headers.get("x-mailchimp-signature");
    const valid = await verifyMailchimpSignature(rawBody, sigHeader, MAILCHIMP_WEBHOOK_SECRET);
    if (!valid) {
      console.error("Invalid Mailchimp webhook signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Always return 200 to prevent Mailchimp retry storms
  try {
    const formData = await req.formData();
    const type = formData.get("type") as string | null;
    const dataJson = formData.get("data[email]") as string | null;

    if (!type || !dataJson) {
      return new Response(JSON.stringify({ status: "ignored" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mappedType = EVENT_MAP[type];
    if (!mappedType) {
      return new Response(JSON.stringify({ status: "ignored", reason: "unmapped type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const toEmail = dataJson.trim().toLowerCase();
    if (!toEmail) {
      return new Response(JSON.stringify({ status: "ignored", reason: "no email" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Mailchimp lacks a stable message ID, so match by to_email + provider + most recent
    const { data: message } = await supabaseAdmin
      .from("email_messages")
      .select("id")
      .eq("to_email", toEmail)
      .eq("provider", "mailchimp")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!message) {
      return new Response(JSON.stringify({ status: "ignored", reason: "no matching message" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For click events, try to match URL
    let linkId: string | null = null;
    const clickUrl = formData.get("data[url]") as string | null;
    if (mappedType === "click" && clickUrl) {
      const { data: link } = await supabaseAdmin
        .from("email_links")
        .select("id")
        .eq("message_id", message.id)
        .eq("destination_url", clickUrl)
        .limit(1)
        .single();
      linkId = link?.id ?? null;
    }

    // Collect raw metadata
    const metadata: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") metadata[key] = value;
    }

    const ip = formData.get("data[ip]") as string | null;

    const { error } = await supabaseAdmin.rpc("record_email_event", {
      p_message_id: message.id,
      p_event_type: mappedType,
      p_link_id: linkId,
      p_ip_address: ip ?? null,
      p_user_agent: null,
      p_is_bot: false,
      p_is_apple_privacy: false,
      p_metadata: metadata,
    });

    if (error) {
      console.error("Mailchimp event recording error:", error.message);
    } else {
      // AI memory: append the interaction to lead_memory. Fire-and-forget.
      supabaseAdmin.rpc("log_lead_memory_email_event", {
        p_message_id: message.id,
        p_event_type: mappedType,
        p_link_id: linkId,
        p_destination_url: clickUrl ?? null,
        p_is_bot: false,
        p_is_apple_privacy: false,
      }).then(({ error: memErr }) => {
        if (memErr) console.warn("Mailchimp memory write skipped:", memErr.message);
      });
    }

    return new Response(JSON.stringify({ status: "processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webhooks-mailchimp error:", err);
    // Always return 200 to prevent retry storms
    return new Response(JSON.stringify({ status: "error", message: (err as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
