// SAM 3.1 photo marking client (OpenAI-compatible vision endpoint).
//
// Mirrors the transcribe.ts pattern: credentials come from environment
// variables only, never hardcoded:
//   META_API_KEY (or LLAMA_API_KEY fallback) - required secret
//   META_SAM_URL   - optional override; the FULL marking URL
//                    (e.g. https://host/.../images/markings)
//   META_SAM_MODEL - optional model name; omitted from the request
//                    when unset (server-side default applies)
//
// Tests inject a fake MarkingClient; no network access in tests.

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

const DEFAULT_SAM_URL = "https://api.llama.com/compat/v1/images/markings";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

function normalizeMarking(raw: unknown): Marking {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("işaretleme yanıtı geçersiz");
  }
  const { boxes } = raw as { boxes?: unknown };
  if (!Array.isArray(boxes)) {
    throw new Error("işaretleme yanıtında kutu yok");
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

const defaultMarkingClient: MarkingClient = {
  async markImage(image: Buffer, hint: string): Promise<Marking> {
    const apiKey = process.env.META_API_KEY ?? process.env.LLAMA_API_KEY;
    if (!apiKey) {
      throw new Error("META_API_KEY is not set");
    }
    const url = process.env.META_SAM_URL ?? DEFAULT_SAM_URL;
    const model = process.env.META_SAM_MODEL;

    const form = new FormData();
    const bytes = new Uint8Array(image.length);
    bytes.set(image);
    form.append("file", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
    form.append("hint", hint);
    if (model) form.append("model", model);

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`marking request failed (${res.status})`);
    }
    return normalizeMarking(await res.json());
  },
};

export async function markPhoto(
  image: Buffer,
  hint: string,
  client: MarkingClient = defaultMarkingClient,
): Promise<Marking> {
  if (!Buffer.isBuffer(image) || image.length === 0) {
    throw new Error("görüntü verisi boş");
  }
  if (image.length > MAX_IMAGE_BYTES) {
    throw new Error("görüntü dosyası çok büyük (en fazla 25MB)");
  }
  if (typeof hint !== "string" || hint.trim().length === 0) {
    throw new Error("ipucu gerekli");
  }
  return normalizeMarking(await client.markImage(image, hint.trim()));
}
