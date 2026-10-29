// Dossier compiler client (role name: PROSECUTOR) — dossier building, briefs.
//
// Uses PROSECUTOR_API_URL / PROSECUTOR_MODEL / PROSECUTOR_API_KEY when
// defined (legacy GLIMMER_API_URL / GLIMMER_MODEL / GLIMMER_API_KEY still
// accepted as fallback). When no compiler env is defined it falls back to the shared
// chat layer (chatCompletion with META_* env), so behaviour is unchanged
// without a dedicated compiler endpoint. Keys come from env only, never
// hardcoded.

import { chatCompletion } from "./meta-client";
import { parseTimeoutMs } from "./model-timeout";

/** Model that actually compiles dossiers/summaries under the current env. */
export function dossierModelName(): string {
  return (
    process.env.PROSECUTOR_MODEL ??
    process.env.GLIMMER_MODEL ??
    process.env.META_MODEL ??
    "Llama-4-Maverick-17B-128E-Instruct-FP8"
  );
}

export async function glimmerChat(prompt: string): Promise<string> {
  const hasGlimmerEnv =
    process.env.PROSECUTOR_API_URL !== undefined ||
    process.env.PROSECUTOR_MODEL !== undefined ||
    process.env.PROSECUTOR_API_KEY !== undefined ||
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
      process.env.PROSECUTOR_API_KEY ??
      process.env.GLIMMER_API_KEY ??
      process.env.MODEL_API_KEY ??
      process.env.META_API_KEY ??
      process.env.LLAMA_API_KEY,
    url:
      process.env.PROSECUTOR_API_URL ??
      process.env.GLIMMER_API_URL ??
      process.env.META_API_URL,
    model:
      process.env.PROSECUTOR_MODEL ??
      process.env.GLIMMER_MODEL ??
      process.env.META_MODEL,
    timeoutMs,
  });
}
