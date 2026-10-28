// Muse Voice Transcribe client (OpenAI-compatible audio endpoint).
//
// Follows the chatCompletion pattern from meta-client.ts: credentials come
// from environment variables only, never hardcoded:
//   META_API_KEY (or LLAMA_API_KEY fallback) - required secret
//   META_TRANSCRIBE_URL   - optional override; the FULL transcriptions URL
//                           (e.g. https://host/.../audio/transcriptions)
//   META_TRANSCRIBE_MODEL - optional model name; omitted from the request
//                           when unset (server-side default applies)
//
// Tests inject a fake TranscriptionClient; no network access in tests.
//
// Bounded timeout: META_TRANSCRIBE_TIMEOUT_MS env (default 120000 ms) or
// the timeoutMs argument of transcribe(); a never-resolving client/fetch
// rejects with a timeout error instead of hanging enrichment.

import { resolveTimeoutMs, withModelTimeout } from "./model-timeout";

export interface TranscriptSegment {
  speaker?: string;
  text: string;
  start?: number;
  end?: number;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
}

// Injectable client seam: tests pass a fake, production uses fetch below.
export interface TranscriptionClient {
  transcribeAudio(audio: Buffer, filename: string): Promise<Transcript>;
}

let clientOverride: TranscriptionClient | undefined;

/** Test seam: tests inject a fake client so no network is used. */
export function __setTranscribeClientForTests(
  client: TranscriptionClient | undefined,
): void {
  clientOverride = client;
}

const DEFAULT_TRANSCRIBE_URL =
  "https://api.llama.com/compat/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function normalizeTranscript(raw: unknown): Transcript {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("transcription yanıtı geçersiz");
  }
  const { text, segments } = raw as {
    text?: unknown;
    segments?: unknown;
  };
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("transcription yanıtında metin yok");
  }
  const list = Array.isArray(segments) ? segments : [];
  const clean: TranscriptSegment[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { speaker, text: segText, start, end } = entry as {
      speaker?: unknown;
      text?: unknown;
      start?: unknown;
      end?: unknown;
    };
    if (typeof segText !== "string" || segText.trim().length === 0) continue;
    const segment: TranscriptSegment = { text: segText.trim() };
    if (typeof speaker === "string" && speaker.trim().length > 0) {
      segment.speaker = speaker.trim();
    }
    if (typeof start === "number" && Number.isFinite(start)) segment.start = start;
    if (typeof end === "number" && Number.isFinite(end)) segment.end = end;
    clean.push(segment);
  }
  return { text: text.trim(), segments: clean };
}

const defaultTranscriptionClient: TranscriptionClient = {
  async transcribeAudio(audio: Buffer, filename: string): Promise<Transcript> {
    const apiKey = process.env.META_API_KEY ?? process.env.LLAMA_API_KEY;
    if (!apiKey) {
      throw new Error("META_API_KEY is not set");
    }
    const url = process.env.META_TRANSCRIBE_URL ?? DEFAULT_TRANSCRIBE_URL;
    const model = process.env.META_TRANSCRIBE_MODEL;

    const form = new FormData();
    const bytes = new Uint8Array(audio.length);
    bytes.set(audio);
    form.append(
      "file",
      new File([bytes], filename || "audio.wav", { type: "audio/wav" }),
    );
    if (model) form.append("model", model);

    const res = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(
        resolveTimeoutMs(undefined, "META_TRANSCRIBE_TIMEOUT_MS"),
      ),
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`transcription request failed (${res.status})`);
    }
    return normalizeTranscript(await res.json());
  },
};

export async function transcribe(
  audio: Buffer,
  filename = "audio.wav",
  client: TranscriptionClient = clientOverride ?? defaultTranscriptionClient,
  timeoutMs?: number,
): Promise<Transcript> {
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    throw new Error("ses verisi boş");
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error("ses dosyası çok büyük (en fazla 25MB)");
  }
  const result = await withModelTimeout(
    client.transcribeAudio(audio, filename),
    resolveTimeoutMs(timeoutMs, "META_TRANSCRIBE_TIMEOUT_MS"),
    "transcription zaman asimi (timeout)",
  );
  return normalizeTranscript(result);
}
