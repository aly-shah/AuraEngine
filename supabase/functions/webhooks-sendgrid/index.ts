import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SENDGRID_WEBHOOK_VERIFICATION_KEY = Deno.env.get("SENDGRID_WEBHOOK_VERIFICATION_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

// Map SendGrid event types to our event types
const EVENT_MAP: Record<string, string> = {
  delivered: "delivered",
  bounce: "bounced",
  open: "open",
  click: "click",
  unsubscribe: "unsubscribe",
  spamreport: "spam_report",
};

async function verifySignature(
  payload: string,
  signature: string | null,
  timestamp: string | null
): Promise<boolean> {
  if (!SENDGRID_WEBHOOK_VERIFICATION_KEY || !signature || !timestamp) return true; // skip if not configured
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SENDGRID_WEBHOOK_VERIFICATION_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const data = new TextEncoder().encode(timestamp + payload);
    const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sig, data);
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.text();

    // Optional signature verification
    const signature = req.headers.get("x-twilio-email-event-webhook-signature");
    const timestamp = req.headers.get("x-twilio-email-event-webhook-timestamp");
    if (SENDGRID_WEBHOOK_VERIFICATION_KEY) {
      const valid = await verifySignature(body, signature, timestamp);
      if (!valid) {
        console.error("Invalid SendGrid webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const events = JSON.parse(body);
    if (!Array.isArray(events)) {
      return new Response(JSON.stringify({ error: "Expected array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let processed = 0;

    for (const event of events) {
      const mappedType = EVENT_MAP[event.event];
      if (!mappedType) continue;

      // Extract SendGrid message ID (strip filter suffix like ".filter...")
      const sgMessageId = (event.sg_message_id ?? "").split(".")[0];
      if (!sgMessageId) continue;

      // Find matching email_messages row (workspace_id + sender_account_id
      // + to_email needed for the email_dlq writer below).
      const { data: message } = await supabaseAdmin
        .from("email_messages")
        .select("id, workspace_id, sender_account_id, to_email, lead_id")
        .eq("provider_message_id", sgMessageId)
        .single();

      if (!message) continue;

      // For click events, try to match the link
      let linkId: string | null = null;
      if (mappedType === "click" && event.url) {
        const { data: link } = await supabaseAdmin
          .from("email_links")
          .select("id")
          .eq("message_id", message.id)
          .eq("destination_url", event.url)
          .limit(1)
          .single();
        linkId = link?.id ?? null;
      }

      // Record the event
      const { error } = await supabaseAdmin.rpc("record_email_event", {
        p_message_id: message.id,
        p_event_type: mappedType,
        p_link_id: linkId,
        p_ip_address: event.ip ?? null,
        p_user_agent: event.useragent ?? null,
        p_is_bot: false,
        p_is_apple_privacy: false,
        p_metadata: {
          sg_event_id: event.sg_event_id,
          sg_message_id: event.sg_message_id,
          response: event.response,
          reason: event.reason,
          status: event.status,
        },
      });

      if (error) {
        console.error("SendGrid event recording error:", error.message);
      } else {
        processed++;
        // AI memory: append delivered/bounced/click/open as lead_memory.
        // Fire-and-forget — failures cannot block webhook processing.
        supabaseAdmin.rpc("log_lead_memory_email_event", {
          p_message_id: message.id,
          p_event_type: mappedType,
          p_link_id: linkId,
          p_destination_url: event.url ?? null,
          p_is_bot: false,
          p_is_apple_privacy: false,
        }).then(({ error: memErr }) => {
          if (memErr) console.warn("SendGrid memory write skipped:", memErr.message);
        });

        // ── Phase 3.2.1: DLQ for hard bounces / spam complaints / unsubscribes ──
        // SendGrid 5xx status code on a bounce = hard bounce (mailbox doesn't exist).
        // 4xx = soft (transient), keep retryable — do not DLQ.
        const statusStr = String(event.status ?? "");
        const isHardBounce =
          mappedType === "bounced" && (statusStr.startsWith("5") || event.type === "bounce");
        const dlqKind: string | null =
          mappedType === "spam_report"  ? "spam_complaint"
          : mappedType === "unsubscribe" ? "unsubscribed"
          : isHardBounce                 ? "hard_bounce"
          : null;

        if (dlqKind && message.workspace_id) {
          supabaseAdmin.from("email_dlq").insert({
            workspace_id:      message.workspace_id,
            sender_account_id: message.sender_account_id,
            message_id:        message.id,
            to_email:          message.to_email,
            kind:              dlqKind,
            reason:            event.reason ?? event.response ?? null,
            metadata: {
              sg_event_id:   event.sg_event_id,
              sg_message_id: event.sg_message_id,
              status:        event.status,
              type:          event.type,
            },
          }).then(({ error: dlqErr }) => {
            if (dlqErr) console.warn("SendGrid DLQ write skipped:", dlqErr.message);
          });
        }
      }
    }

    return new Response(JSON.stringify({ processed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("webhooks-sendgrid error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
