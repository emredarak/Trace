// SAM 3.1 photo marking client — POST https://api.meta.ai/v1/responses
//
// Docs: https://dev.meta.ai/docs/sam/overview
// One Responses API call per concept: input_text names a single short noun
// phrase (e.g. "knife"), input_image carries the photo (data URL). The model
// returns special-token text with one box+mask per match; we parse boxes and
// normalize to 0-1 coordinates. Zero matches is normal (empty boxes).
// The hint may name several concepts ("knife on pier at night"); we try up
// to MAX_CONCEPTS single-noun concepts per call and label each box with the
// concept that found it.
//
// Credentials come from environment variables only, never hardcoded:
//   MODEL_API_KEY (or META_API_KEY / LLAMA_API_KEY fallback) - required secret
//   META_SAM_URL   - optional override (full Responses URL)
//   META_SAM_MODEL - optional model override (default sam-3.1)
//
// Tests inject a fake MarkingClient; no network access in tests.
//
// Bounded timeout: META_SAM_TIMEOUT_MS env (default 120000 ms) or the
// timeoutMs argument of markPhoto(); a never-resolving client/fetch
// rejects with a timeout error instead of hanging enrichment.

import { resolveTimeoutMs, withModelTimeout } from "./model-timeout";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface Marking {
  boxes: Box[];
}

// Injectable client seam: tests pass a fake, production uses fetch below.
export interface MarkingClient {
  markImage(image: Buffer, hint: string): Promise<Marking>;
}

let clientOverride: MarkingClient | undefined;

/** Test seam: tests inject a fake client so no network is used. */
export function __setMarkPhotoClientForTests(
  client: MarkingClient | undefined,
): void {
  clientOverride = client;
}

export const DEFAULT_SAM_URL = "https://api.meta.ai/v1/responses";
export const DEFAULT_SAM_MODEL = "sam-3.1";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** One concept per SAM request; cap concepts per hint. */
const MAX_CONCEPTS = 3;

const STOPWORDS = new Set(
  "a,an,the,on,in,at,by,of,with,near,beside,front,back,night,day,daylight,photo,close,up,wide,shot,scene,evidence,marker,red,open,scattered,standing,lying,sitting,charred,burnt,soot,marked,small,large,wooden,metal,white,black".split(
    ",",
  ),
);

/** Split a hint into up to MAX_CONCEPTS single-noun concepts SAM accepts. */
export function conceptsForHint(hint: string): string[] {
  const words = hint
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  const out: string[] = [];
  // Prefer known multi-word concepts first.
  const joined = ` ${words.join(" ")} `;
  for (const phrase of [
    "gasoline can",
    "fishing rod",
    "tackle bag",
    "cabin door",
    "door frame",
    "flashlight",
  ]) {
    if (joined.includes(` ${phrase} `) && out.length < MAX_CONCEPTS) {
      out.push(phrase);
    }
  }
  for (const w of words) {
    if (out.length >= MAX_CONCEPTS) break;
    if (w.length < 3) continue;
    if (out.some((c) => c.includes(w))) continue;
    out.push(w);
  }
  return out.slice(0, MAX_CONCEPTS);
}

function normalizeMarking(raw: unknown): Marking {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("invalid marking response");
  }
  const { boxes } = raw as { boxes?: unknown };
  if (!Array.isArray(boxes)) {
    throw new Error("marking response has no boxes");
  }
  const clean: Box[] = [];
  for (const entry of boxes) {
    if (typeof entry !== "object" || entry === null) continue;
    const { x, y, w, h, label } = entry as {
      x?: unknown;
      y?: unknown;
      w?: unknown;
      h?: unknown;
      label?: unknown;
    };
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof w !== "number" ||
      typeof h !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0
    ) {
      continue;
    }
    if (typeof label !== "string" || label.trim().length === 0) continue;
    clean.push({ x, y, w, h, label: label.trim() });
  }
  return { boxes: clean };
}

/** Extract SAM box tokens from Responses output_text into normalized boxes. */
function boxesFromOutputText(text: string, label: string): Box[] {
  const boxes: Box[] = [];
  const re =
    /<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)[^|]*\|>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const x1 = Number(m[1]);
    const y1 = Number(m[2]);
    const x2 = Number(m[3]);
    const y2 = Number(m[4]);
    const w = Number(m[5]);
    const h = Number(m[6]);
    if (!w || !h) continue;
    // x2/y2 are inclusive: +1 so a 1px box has non-zero size.
    const x = Math.min(Math.max(x1 / w, 0), 1);
    const y = Math.min(Math.max(y1 / h, 0), 1);
    const bw = Math.min(Math.max((x2 - x1 + 1) / w, 0), 1 - x);
    const bh = Math.min(Math.max((y2 - y1 + 1) / h, 0), 1 - y);
    if (bw <= 0 || bh <= 0) continue;
    boxes.push({ x, y, w: bw, h: bh, label });
  }
  return boxes;
}

function outputTextFromResponse(data: unknown): string {
  // Non-streaming Responses shape: {output:[{content:[{text}]}]}
  if (typeof data !== "object" || data === null) return "";
  const output = (data as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    // Some SDKs surface result text directly on the item.
    const result = (item as { result?: unknown }).result;
    if (typeof result === "string") parts.push(result);
  }
  return parts.join("\n");
}

function contentTypeForImage(image: Buffer): string {
  if (image.length >= 12) {
    const head = image.subarray(0, 12).toString("binary");
    if (head.startsWith("\x89PNG")) return "image/png";
    if (head.startsWith("RIFF") && image.subarray(8, 12).toString("binary") === "WEBP")
      return "image/webp";
    if (head.startsWith("\xFF\xD8\xFF")) return "image/jpeg";
    if (head.startsWith("GIF8")) return "image/gif";
  }
  return "image/jpeg";
}

const defaultMarkingClient: MarkingClient = {
  async markImage(image: Buffer, hint: string): Promise<Marking> {
    const apiKey =
      process.env.MODEL_API_KEY ??
      process.env.META_API_KEY ??
      process.env.LLAMA_API_KEY;
    if (!apiKey) {
      throw new Error("MODEL_API_KEY is not set");
    }
    const url = process.env.META_SAM_URL ?? DEFAULT_SAM_URL;
    const model = process.env.META_SAM_MODEL ?? DEFAULT_SAM_MODEL;

    const concepts = conceptsForHint(hint);
    if (concepts.length === 0) return { boxes: [] };
    const mime = contentTypeForImage(image);
    const dataUrl = `data:${mime};base64,${image.toString("base64")}`;
    const boxes: Box[] = [];
    for (const concept of concepts) {
      const res = await fetch(url, {
        method: "POST",
        signal: AbortSignal.timeout(
          resolveTimeoutMs(undefined, "META_SAM_TIMEOUT_MS"),
        ),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            {
              type: "message",
              role: "user",
              content: [
                { type: "input_text", text: concept },
                { type: "input_image", image_url: dataUrl },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`marking request failed (${res.status})`);
      }
      const text = outputTextFromResponse(await res.json());
      // Zero matches is normal: empty output_text, no boxes.
      for (const b of boxesFromOutputText(text, concept)) boxes.push(b);
    }
    return { boxes };
  },
};

export async function markPhoto(
  image: Buffer,
  hint: string,
  client: MarkingClient = clientOverride ?? defaultMarkingClient,
  timeoutMs?: number,
): Promise<Marking> {
  if (!Buffer.isBuffer(image) || image.length === 0) {
    throw new Error("image data is empty");
  }
  if (image.length > MAX_IMAGE_BYTES) {
    throw new Error("image file too large (max 25MB)");
  }
  if (typeof hint !== "string" || hint.trim().length === 0) {
    throw new Error("hint is required");
  }
  const result = await withModelTimeout(
    client.markImage(image, hint.trim()),
    resolveTimeoutMs(timeoutMs, "META_SAM_TIMEOUT_MS"),
    "marking timeout",
  );
  return normalizeMarking(result);
}
