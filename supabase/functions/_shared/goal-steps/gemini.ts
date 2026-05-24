// supabase/functions/_shared/goal-steps/gemini.ts
//
// Server-side Gemini call used by enrich/score/email/social step handlers.
// The browser route goes through gemini-proxy; this one is internal and
// uses the GEMINI_API_KEY directly (already in the edge function env).

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";

export async function geminiGenerate(
  apiKey: string,
  prompt: string,
  systemInstruction: string,
  opts?: { responseMimeType?: string },
): Promise<{ text: string; tokens: number }> {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const url = `${GEMINI_ENDPOINT}?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      temperature: 0.5,
      topP: 0.9,
      ...(opts?.responseMimeType ? { responseMimeType: opts.responseMimeType } : {}),
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const tokens = j.usageMetadata?.totalTokenCount ?? 0;
  return { text, tokens };
}
