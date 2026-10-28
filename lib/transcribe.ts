// Muse Voice Transcribe client — POST https://api.meta.ai/v1/asr/transcribe
//
// Docs: https://dev.meta.ai/docs/speech-to-text
// Endpoint accepts multipart/form-data with two parts:
//   request: JSON {model, audioEncoding:"WAV", mode, languageBias, keywords}
//   audio:   WAV file (RIFF mono 16-bit PCM at 16 or 24 kHz)
// Response JSON: {transcript, turns[{turnId,startMs,endMs,transcript,speaker}], ...}
// We request DIARIZATION so multi-speaker audio comes back attributed (A, B...).
// Turns map to Transcript segments (start/end in seconds).
//
// Credentials come from environment variables only, never hardcoded:
//   MODEL_API_KEY (or META_API_KEY / LLAMA_API_KEY fallback) - required secret
//   META_TRANSCRIBE_URL   - optional override (full transcribe URL)
//   META_TRANSCRIBE_MODEL - optional model override (default muse-voice-transcribe-1.0)
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

export const DEFAULT_TRANSCRIBE_URL =
  "https://api.meta.ai/v1/asr/transcribe";
export const DEFAULT_TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function isWav(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  );
}

interface TurnRaw {
  turnId?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  transcript?: unknown;
  speaker?: unknown;
}

function segmentFromTurn(turn: TurnRaw): TranscriptSegment | null {
  if (typeof turn !== "object" || turn === null) return null;
  const text =
    typeof turn.transcript === "string" ? turn.transcript.trim() : "";
  if (!text) return null;
  const segment: TranscriptSegment = { text };
  if (typeof turn.speaker === "string" && turn.speaker.trim()) {
    segment.speaker = turn.speaker.trim();
  }
  if (typeof turn.startMs === "number" && Number.isFinite(turn.startMs)) {
    segment.start = turn.startMs / 1000;
  }
  if (typeof turn.endMs === "number" && Number.isFinite(turn.endMs)) {
    segment.end = turn.endMs / 1000;
  }
  return segment;
}

function normalizeTranscript(raw: unknown): Transcript {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid transcription response");
  }
  const { text, segments, transcript, turns } = raw as {
    text?: unknown;
    segments?: unknown;
    transcript?: unknown;
    turns?: unknown;
  };
  // Real API shape: {transcript, turns[]}
  if (typeof transcript === "string" && Array.isArray(turns)) {
    const full = transcript.trim();
    if (!full) throw new Error("transcription response has no text");
    const clean: TranscriptSegment[] = [];
    for (const entry of turns) {
      const seg = segmentFromTurn(entry as TurnRaw);
      if (seg) clean.push(seg);
    }
    // PUSH_TO_TALK returns empty turns with full transcript; keep one segment.
    if (clean.length === 0) return { text: full, segments: [{ text: full }] };
    return { text: full, segments: clean };
  }
  // Legacy/test seam shape: {text, segments[]}
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("transcription response has no text");
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
    const apiKey =
      process.env.MODEL_API_KEY ??
      process.env.META_API_KEY ??
      process.env.LLAMA_API_KEY;
    if (!apiKey) {
      throw new Error("MODEL_API_KEY is not set");
    }
    const url = process.env.META_TRANSCRIBE_URL ?? DEFAULT_TRANSCRIBE_URL;
    const model = process.env.META_TRANSCRIBE_MODEL ?? DEFAULT_TRANSCRIBE_MODEL;

    const form = new FormData();
    const bytes = new Uint8Array(audio.length);
    bytes.set(audio);
    const requestPart = JSON.stringify({
      model,
      audioEncoding: "WAV",
      mode: "DIARIZATION",
      languageBias: ["English"],
    });
    form.append(
      "request",
      new File([requestPart], "request.json", { type: "application/json" }),
    );
    form.append(
      "audio",
      new File([bytes], filename || "audio.wav", { type: "audio/wav" }),
    );

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
    throw new Error("audio data is empty");
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new Error("audio file too large (max 25MB)");
  }
  if (!isWav(audio) && client === defaultTranscriptionClient) {
    throw new Error(
      "audio must be WAV (mono 16-bit PCM at 16 or 24 kHz); convert first (e.g. ffmpeg -ac 1 -ar 24000 -c:a pcm_s16le)",
    );
  }
  const result = await withModelTimeout(
    client.transcribeAudio(audio, filename),
    resolveTimeoutMs(timeoutMs, "META_TRANSCRIBE_TIMEOUT_MS"),
    "transcription timeout",
  );
  return normalizeTranscript(result);
}
