import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "../lib/meta-client";
import { sparkChat } from "../lib/spark-client";
import { glimmerChat } from "../lib/glimmer-client";
import { rerank } from "../lib/rerank";
import { fieldBrief } from "../lib/field-brief";
import type { CaseRecord } from "../lib/case-schema";

const ENV_KEYS = [
  "BASETEN_API_KEY",
  "BASETEN_API_URL",
  "SPARK_MODEL",
  "MODEL_API_KEY",
  "META_API_KEY",
  "LLAMA_API_KEY",
  "META_API_URL",
  "META_MODEL",
  "GLIMMER_API_KEY",
  "JUDGE_API_URL",
  "JUDGE_MODEL",
  "PROSECUTOR_API_URL",
  "PROSECUTOR_MODEL",
  "PROSECUTOR_API_KEY",
  "GLIMMER_API_URL",
  "GLIMMER_MODEL",
  "META_TIMEOUT_MS",
  "GLIMMER_TIMEOUT_MS",
] as const;

let savedEnv: Record<string, string | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;

function mockFetchReturning(text: string) {
  fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastCall() {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [
    string,
    { headers: Record<string, string>; body: string },
  ];
  return { url, init, body: JSON.parse(init.body) as Record<string, any> };
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sparkChat", () => {
  it("with BASETEN_API_KEY, Baseten URL/model/key is selected (even when Meta envs are set)", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("spark response");

    await expect(sparkChat("hello")).resolves.toBe("spark response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://baseten.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer baseten-key");
    expect(body.model).toBe("spark-model");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("without BASETEN_API_KEY, Meta API (META_API_KEY/META_API_URL/META_MODEL) is selected", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("meta response");

    await expect(sparkChat("hello")).resolves.toBe("meta response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://meta.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer meta-key");
    expect(body.model).toBe("meta-model");
  });

  it("LLAMA_API_KEY is used as fallback when META_API_KEY is missing", async () => {
    process.env.LLAMA_API_KEY = "llama-key";
    mockFetchReturning("llama response");

    await expect(sparkChat("hello")).resolves.toBe("llama response");

    const { init } = lastCall();
    expect(init.headers.Authorization).toBe("Bearer llama-key");
  });

  it("MODEL_API_KEY becomes the primary key when META_API_KEY is missing", async () => {
    process.env.MODEL_API_KEY = "model-key";
    mockFetchReturning("model response");

    await expect(sparkChat("hello")).resolves.toBe("model response");

    const { init } = lastCall();
    expect(init.headers.Authorization).toBe("Bearer model-key");
  });

  it("JUDGE_MODEL takes precedence over META_MODEL", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.JUDGE_MODEL = "judge-model";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("arbiter response");

    await expect(sparkChat("compare")).resolves.toBe("arbiter response");

    const { body } = lastCall();
    expect(body.model).toBe("judge-model");
  });

  it("throws when no key is set, fetch is not called", async () => {
    mockFetchReturning("never");

    await expect(sparkChat("hello")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("images are sent as multi-modal content", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    mockFetchReturning("image response");

    await sparkChat("compare", [
      {
        caseId: "case-1",
        evidenceId: "ev-1",
        dataUrl: "data:image/jpeg;base64,AAAA",
      },
    ]);

    const { body } = lastCall();
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "compare" });
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
  });
});

describe("glimmerChat", () => {
  it("when GLIMMER_* envs are set, Glimmer URL/model/key is used", async () => {
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_MODEL = "glimmer-model";
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("glimmer response");

    await expect(glimmerChat("summarize")).resolves.toBe("glimmer response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://glimmer.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer glimmer-key");
    expect(body.model).toBe("glimmer-model");
  });

  it("when GLIMMER_* is unset, falls back to the chat layer (Meta envs)", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("meta response");

    await expect(glimmerChat("summarize")).resolves.toBe("meta response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://meta.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer meta-key");
    expect(body.model).toBe("meta-model");
  });

  it("PROSECUTOR_* envs take precedence over GLIMMER_* and Meta envs", async () => {
    process.env.PROSECUTOR_API_KEY = "prosecutor-key";
    process.env.PROSECUTOR_API_URL = "https://prosecutor.example/v1/chat/completions";
    process.env.PROSECUTOR_MODEL = "prosecutor-model";
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_MODEL = "glimmer-model";
    mockFetchReturning("compiler response");

    await expect(glimmerChat("summarize")).resolves.toBe("compiler response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://prosecutor.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer prosecutor-key");
    expect(body.model).toBe("prosecutor-model");
  });

  it("throws when no key is set", async () => {
    mockFetchReturning("never");

    await expect(glimmerChat("summarize")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chatCompletion (parametric layer)", () => {
  it("explicit url/model/key params take precedence over env", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("parametric response");

    await expect(
      chatCompletion("hi", {
        apiKey: "explicit-key",
        url: "https://explicit.example/chat/completions",
        model: "explicit-model",
      }),
    ).resolves.toBe("parametric response");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://explicit.example/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer explicit-key");
    expect(body.model).toBe("explicit-model");
  });

  it("throws when the key is missing (current behavior)", async () => {
    mockFetchReturning("never");
    await expect(chatCompletion("hi")).rejects.toThrow(
      "META_API_KEY is not set",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unresponsive endpoint rejects with a short timeout (AbortSignal goes to fetch)", async () => {
    process.env.META_API_KEY = "meta-key";
    fetchMock = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      chatCompletion("hi", { timeoutMs: 20 }),
    ).rejects.toThrow();
    const [, init] = fetchMock.mock.calls[0] as [string, { signal?: unknown }];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("GLIMMER_TIMEOUT_MS env is reflected as a short timeout on the Glimmer call", async () => {
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_TIMEOUT_MS = "20";
    fetchMock = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(glimmerChat("summarize")).rejects.toThrow();
  });
});

describe("default client wiring", () => {
  function makeCase(
    overrides: Partial<CaseRecord> & Pick<CaseRecord, "id" | "summary">,
  ): CaseRecord {
    return {
      caseNo: `TR-${overrides.id}`,
      needsRerank: false,
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-26T00:00:00.000Z",
      ...overrides,
    };
  }

  it("rerank default client uses the Spark layer", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    const candidate = makeCase({ id: "case-a", summary: "waterfront attack" });
    const query = makeCase({ id: "query", summary: "waterfront attack" });
    mockFetchReturning(
      JSON.stringify([
        { caseId: "case-a", score: 9, reason: "very similar", quote: candidate.summary },
      ]),
    );

    const ranked = await rerank([candidate], query);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(9);
    const { url, body } = lastCall();
    expect(url).toBe("https://baseten.example/v1/chat/completions");
    expect(body.model).toBe("spark-model");
  });

  it("fieldBrief default client uses the Glimmer layer", async () => {
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_MODEL = "glimmer-model";
    mockFetchReturning("One-sentence summary.");
    const entries = [
      { type: "transcript", note: "I saw the white car at night" },
    ] as Parameters<typeof fieldBrief>[0];

    await expect(fieldBrief(entries)).resolves.toBe("One-sentence summary.");

    const { url, body } = lastCall();
    expect(url).toBe("https://glimmer.example/v1/chat/completions");
    expect(body.model).toBe("glimmer-model");
  });
});
