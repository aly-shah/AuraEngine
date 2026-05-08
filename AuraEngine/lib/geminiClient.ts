// AuraEngine/lib/geminiClient.ts
//
// Thin proxy shim that replaces direct @google/genai SDK usage from the
// browser. All Gemini traffic now routes through the `gemini-proxy` Supabase
// Edge Function (GEMINI_API_KEY lives there, not in the client bundle).
//
// The shapes of `generateContent` / `generateContentStream` payloads mirror
// the SDK's `ai.models.*` calls exactly — drop-in replacement. The returned
// objects expose the same subset of fields call sites read today: `text`,
// `candidates`, `usageMetadata`.

import { supabase } from './supabase';

interface GenerateContentRequest {
  model: string;
  contents: unknown;
  config?: Record<string, unknown>;
}

interface GenerateImagesRequest {
  model: string;
  prompt: string;
  config?: Record<string, unknown>;
}

export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  [k: string]: unknown;
}

export interface GeminiResponse {
  text: string;
  candidates: unknown[];
  usageMetadata: GeminiUsageMetadata | null;
}

export interface GeminiGeneratedImage {
  image?: { imageBytes?: string };
}

export interface GeminiImagesResponse {
  generatedImages: GeminiGeneratedImage[];
}

async function invokeProxy<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>(
    'gemini-proxy',
    { body },
  );
  if (error) throw new Error(error.message || 'gemini-proxy invocation failed');
  if (!data) throw new Error('gemini-proxy returned no data');
  if ((data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data;
}

/**
 * Drop-in replacement for `ai.models.generateContent(...)`.
 * Returns the same `{ text, candidates, usageMetadata }` shape callers already read.
 */
export async function generateContent(request: GenerateContentRequest): Promise<GeminiResponse> {
  return invokeProxy<GeminiResponse>({ ...request, kind: 'content', stream: false });
}

/**
 * Drop-in replacement for `ai.models.generateImages(...)`.
 * Returns the same `{ generatedImages: [{ image: { imageBytes } }] }` shape.
 */
export async function generateImages(request: GenerateImagesRequest): Promise<GeminiImagesResponse> {
  return invokeProxy<GeminiImagesResponse>({ ...request, kind: 'images' });
}

/**
 * Drop-in replacement for `ai.models.generateContentStream(...)`.
 * Returns an async iterable of chunks with the same `{ text, candidates, usageMetadata }` shape.
 *
 * Uses fetch directly against the Edge Function URL because
 * `supabase.functions.invoke()` does not expose streaming bodies.
 */
export async function* generateContentStream(
  request: GenerateContentRequest,
): AsyncGenerator<GeminiResponse, void, unknown> {
  const supabaseUrl = (import.meta as { env: Record<string, string> }).env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('VITE_SUPABASE_URL not configured');

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${supabaseUrl}/functions/v1/gemini-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...request, stream: true }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`gemini-proxy stream failed: ${res.status} ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: split on blank lines
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        yield JSON.parse(payload) as GeminiResponse;
      } catch {
        // ignore malformed lines
      }
    }
  }
}

/**
 * Compatibility shim mirroring `new GoogleGenAI({ apiKey }).models`.
 * Existing code patterns like `const ai = new GoogleGenAI(...); ai.models.generateContent(...)`
 * can be replaced with `const ai = getGeminiClient(); ai.models.generateContent(...)` for
 * a minimal diff.
 */
export function getGeminiClient(): {
  models: {
    generateContent: typeof generateContent;
    generateContentStream: typeof generateContentStream;
    generateImages: typeof generateImages;
  };
} {
  return { models: { generateContent, generateContentStream, generateImages } };
}
