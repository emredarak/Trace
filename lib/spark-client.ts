// Similarity judge client (role name: JUDGE).
//
// Endpoint priority (keys only from env, never hardcoded):
//   1. BASETEN_API_KEY set -> Baseten endpoint
//      (BASETEN_API_URL, SPARK_MODEL overrides)
//   2. otherwise Meta API (MODEL_API_KEY, or META_API_KEY / LLAMA_API_KEY fallback;
//      JUDGE_API_URL, JUDGE_MODEL overrides, then META_API_URL / META_MODEL)
// With no key at all the shared chat layer throws, and callers fall back
// to unscored behaviour (see lib/rerank.ts).

import { chatCompletion } from "./meta-client";
import type { ChatCompletionImage } from "./meta-client";

export type SparkImage = ChatCompletionImage;

const DEFAULT_BASETEN_API_URL =
  "https://inference.baseten.co/v1/chat/completions";
const DEFAULT_SPARK_MODEL = "muse-spark-open";
const DEFAULT_META_API_URL =
  "https://api.llama.com/compat/v1/chat/completions";
const DEFAULT_META_MODEL = "Llama-4-Maverick-17B-128E-Instruct-FP8";

export async function sparkChat(
  prompt: string,
  images?: SparkImage[],
): Promise<string> {
  if (process.env.BASETEN_API_KEY) {
    return chatCompletion(prompt, {
      apiKey: process.env.BASETEN_API_KEY,
      url: process.env.BASETEN_API_URL ?? DEFAULT_BASETEN_API_URL,
      model: process.env.SPARK_MODEL ?? DEFAULT_SPARK_MODEL,
      images,
    });
  }
  return chatCompletion(prompt, {
    apiKey:
      process.env.MODEL_API_KEY ??
      process.env.META_API_KEY ??
      process.env.LLAMA_API_KEY,
    url:
      process.env.JUDGE_API_URL ??
      process.env.META_API_URL ??
      DEFAULT_META_API_URL,
    model:
      process.env.JUDGE_MODEL ??
      process.env.META_MODEL ??
      DEFAULT_META_MODEL,
    images,
  });
}
