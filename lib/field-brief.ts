// Muse Glimmer field-note brief (one-sentence summary of voice transcripts).
//
// Mirrors the transcribe.ts injectable-client pattern: tests inject a fake
// client, production POSTs to the Glimmer chat endpoint via meta-client.
// Credentials come from environment variables only, never hardcoded
// (see meta-client.ts: META_API_KEY / LLAMA_API_KEY, META_API_URL, META_MODEL).
//
// Standalone function for later wiring; never throws — on empty input or any
// failure it resolves to "" so the record is never lost.

import type { Evidence } from "./case-schema";
import { chatCompletion } from "./meta-client";

// Injectable client seam: tests pass a fake, production uses chatCompletion.
export interface FieldBriefClient {
  summarize(prompt: string): Promise<string>;
}

let clientOverride: FieldBriefClient | undefined;

/** Test seam: tests inject a fake client so no network is used. */
export function __setFieldBriefClientForTests(
  client: FieldBriefClient | undefined,
): void {
  clientOverride = client;
}

const defaultFieldBriefClient: FieldBriefClient = {
  summarize: (prompt: string) => chatCompletion(prompt),
};

function collectTranscripts(
  entries: Pick<Evidence, "type" | "note">[],
): string[] {
  return entries
    .filter((e) => e?.type === "transcript")
    .map((e) => (typeof e.note === "string" ? e.note.trim() : ""))
    .filter((t) => t.length > 0);
}

export async function fieldBrief(
  entries: Pick<Evidence, "type" | "note">[],
  client: FieldBriefClient = clientOverride ?? defaultFieldBriefClient,
): Promise<string> {
  const transcripts = collectTranscripts(entries ?? []);
  if (transcripts.length === 0) return "";
  const prompt = [
    "Aşağıdaki saha ses-not çözümlerini tek cümleyle özetle. Sadece özet cümlesini döndür.",
    ...transcripts.map((t, i) => `${i + 1}. ${t}`),
  ].join("\n");
  try {
    const out = await client.summarize(prompt);
    return typeof out === "string" ? out.trim() : "";
  } catch {
    // Özet atlanır, kayıt kaybolmaz.
    return "";
  }
}
