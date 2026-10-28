// Meta Model API (OpenAI-compatible) chat client — shared chat layer.
//
// Credentials come from environment variables only, never hardcoded:
//   META_API_KEY (or LLAMA_API_KEY fallback) - required secret
//   META_API_URL  - optional override; must be the FULL chat-completions URL
//                   (e.g. https://host/.../chat/completions), not a base URL,
//                   since it is POSTed to directly
//   META_MODEL    - optional model name override
//
// Callers (spark-client, glimmer-client) may pass explicit url/model/apiKey
// and multimodal image parts; explicit options win over the META_* env vars.
//
// Bounded timeout: META_TIMEOUT_MS env (default 120000 ms, consistent with
// SPARK_TIMEOUT_MS) or options.timeoutMs; applied via AbortSignal.timeout
// so a never-resolving endpoint rejects instead of hanging the request.

import { resolveTimeoutMs } from "./model-timeout";

const DEFAULT_API_URL =
  "https://api.llama.com/compat/v1/chat/completions";
const DEFAULT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

export interface ChatCompletionImage {
  caseId: string;
  evidenceId: string;
  dataUrl: string;
}

export interface ChatCompletionOptions {
  apiKey?: string;
  url?: string;
  model?: string;
  images?: ChatCompletionImage[];
  /** Bounded fetch timeout in ms; defaults to META_TIMEOUT_MS or 120000. */
  timeoutMs?: number;
}

interface ChatMessagePart {
  text?: unknown;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as ChatMessagePart[])
      .filter((p) => typeof p?.text === "string")
      .map((p) => p.text as string)
      .join("");
  }
  throw new Error("Meta Model API returned no text content");
}

export async function chatCompletion(
  prompt: string,
  options: ChatCompletionOptions = {},
): Promise<string> {
  const apiKey =
    options.apiKey ??
    process.env.MODEL_API_KEY ??
    process.env.META_API_KEY ??
    process.env.LLAMA_API_KEY;
  if (!apiKey) {
    throw new Error("META_API_KEY is not set");
  }
  const url = options.url ?? process.env.META_API_URL ?? DEFAULT_API_URL;
  const model = options.model ?? process.env.META_MODEL ?? DEFAULT_MODEL;

  const content =
    options.images && options.images.length > 0
      ? [
          { type: "text", text: prompt },
          ...options.images.map((img) => ({
            type: "image_url",
            image_url: { url: img.dataUrl },
          })),
        ]
      : prompt;

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(
      resolveTimeoutMs(options.timeoutMs, "META_TIMEOUT_MS"),
    ),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    throw new Error(`Meta Model API request failed (${res.status})`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return extractText(data.choices?.[0]?.message?.content);
}
