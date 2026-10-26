// Meta Model API (OpenAI-compatible) chat client.
//
// Credentials come from environment variables only, never hardcoded:
//   META_API_KEY (or LLAMA_API_KEY fallback) - required secret
//   META_API_URL  - optional endpoint override
//   META_MODEL    - optional model name override

const DEFAULT_API_URL =
  "https://api.llama.com/compat/v1/chat/completions";
const DEFAULT_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

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

export async function chatCompletion(prompt: string): Promise<string> {
  const apiKey = process.env.META_API_KEY ?? process.env.LLAMA_API_KEY;
  if (!apiKey) {
    throw new Error("META_API_KEY is not set");
  }
  const url = process.env.META_API_URL ?? DEFAULT_API_URL;
  const model = process.env.META_MODEL ?? DEFAULT_MODEL;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
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
