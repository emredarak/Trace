// Muse Glimmer client — the compiler agent (dossier building, briefs).
//
// Uses GLIMMER_API_URL / GLIMMER_MODEL / GLIMMER_API_KEY when defined.
// When no GLIMMER_* env is defined it falls back to the shared chat layer
// (chatCompletion with META_* env), so behaviour is unchanged without a
// dedicated Glimmer endpoint. Keys come from env only, never hardcoded.

import { chatCompletion } from "./meta-client";
import { parseTimeoutMs } from "./model-timeout";

export async function glimmerChat(prompt: string): Promise<string> {
  const hasGlimmerEnv =
    process.env.GLIMMER_API_URL !== undefined ||
    process.env.GLIMMER_MODEL !== undefined ||
    process.env.GLIMMER_API_KEY !== undefined;
  // GLIMMER_TIMEOUT_MS overrides the shared META_TIMEOUT_MS default.
  const timeoutMs =
    process.env.GLIMMER_TIMEOUT_MS !== undefined
      ? parseTimeoutMs(process.env.GLIMMER_TIMEOUT_MS)
      : undefined;
  if (!hasGlimmerEnv) {
    return chatCompletion(prompt, { timeoutMs });
  }
  return chatCompletion(prompt, {
    apiKey:
      process.env.GLIMMER_API_KEY ??
      process.env.META_API_KEY ??
      process.env.LLAMA_API_KEY,
    url: process.env.GLIMMER_API_URL ?? process.env.META_API_URL,
    model: process.env.GLIMMER_MODEL ?? process.env.META_MODEL,
    timeoutMs,
  });
}
