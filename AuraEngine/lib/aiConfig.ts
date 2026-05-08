// AuraEngine/lib/aiConfig.ts
//
// Centralised AI model configuration. Every Gemini call site should pull its
// model name + default sampling params from here so a model upgrade is a
// one-file change instead of a global grep-and-replace.

export const AI_MODELS = {
  /** Default text generation model used by lead/content/email/dashboard flows. */
  text: 'gemini-3-flash-preview',
  /** Image generation model (Imagen via gemini-proxy kind:"images"). */
  image: 'imagen-4.0-generate-001',
  /** Lightweight model used for prompt-lab test runs in ModelTraining. */
  textTesting: 'gemini-2.0-flash',
} as const;

export const AI_DEFAULTS = {
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  /** Per-call timeout for non-streaming Gemini requests (ms). */
  timeoutMs: 15_000,
  /** Retry attempts for transient upstream failures. */
  maxRetries: 3,
} as const;

export function getTextModel(): string {
  return AI_MODELS.text;
}

export function getImageModel(): string {
  return AI_MODELS.image;
}
