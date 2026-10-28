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
  "META_API_KEY",
  "LLAMA_API_KEY",
  "META_API_URL",
  "META_MODEL",
  "GLIMMER_API_KEY",
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
  it("BASETEN_API_KEY varken Baseten URL/model/anahtarı seçilir (Meta env'leri dolu olsa bile)", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("spark yanıtı");

    await expect(sparkChat("merhaba")).resolves.toBe("spark yanıtı");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://baseten.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer baseten-key");
    expect(body.model).toBe("spark-model");
    expect(body.messages).toEqual([{ role: "user", content: "merhaba" }]);
  });

  it("BASETEN_API_KEY yokken Meta API (META_API_KEY/META_API_URL/META_MODEL) seçilir", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("meta yanıtı");

    await expect(sparkChat("merhaba")).resolves.toBe("meta yanıtı");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://meta.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer meta-key");
    expect(body.model).toBe("meta-model");
  });

  it("META_API_KEY yokken LLAMA_API_KEY yedeği kullanılır", async () => {
    process.env.LLAMA_API_KEY = "llama-key";
    mockFetchReturning("llama yanıtı");

    await expect(sparkChat("merhaba")).resolves.toBe("llama yanıtı");

    const { init } = lastCall();
    expect(init.headers.Authorization).toBe("Bearer llama-key");
  });

  it("hiçbir anahtar yokken hata fırlatır, fetch çağrılmaz", async () => {
    mockFetchReturning("asla");

    await expect(sparkChat("merhaba")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("görseller çok modlu içerik olarak gönderilir", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    mockFetchReturning("görsel yanıtı");

    await sparkChat("karşılaştır", [
      {
        caseId: "case-1",
        evidenceId: "ev-1",
        dataUrl: "data:image/jpeg;base64,AAAA",
      },
    ]);

    const { body } = lastCall();
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toEqual({ type: "text", text: "karşılaştır" });
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
  });
});

describe("glimmerChat", () => {
  it("GLIMMER_* env'leri tanımlıysa Glimmer URL/model/anahtarı kullanılır", async () => {
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_MODEL = "glimmer-model";
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("glimmer yanıtı");

    await expect(glimmerChat("özetle")).resolves.toBe("glimmer yanıtı");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://glimmer.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer glimmer-key");
    expect(body.model).toBe("glimmer-model");
  });

  it("GLIMMER_* tanımsızsa chat katmanına (Meta env'leri) düşer", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("meta yanıtı");

    await expect(glimmerChat("özetle")).resolves.toBe("meta yanıtı");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://meta.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer meta-key");
    expect(body.model).toBe("meta-model");
  });

  it("hiçbir anahtar yokken hata fırlatır", async () => {
    mockFetchReturning("asla");

    await expect(glimmerChat("özetle")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("chatCompletion (parametrik katman)", () => {
  it("açık url/model/anahtar parametreleri env'den önce gelir", async () => {
    process.env.META_API_KEY = "meta-key";
    process.env.META_API_URL = "https://meta.example/v1/chat/completions";
    process.env.META_MODEL = "meta-model";
    mockFetchReturning("parametrik yanıt");

    await expect(
      chatCompletion("selam", {
        apiKey: "explicit-key",
        url: "https://explicit.example/chat/completions",
        model: "explicit-model",
      }),
    ).resolves.toBe("parametrik yanıt");

    const { url, init, body } = lastCall();
    expect(url).toBe("https://explicit.example/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer explicit-key");
    expect(body.model).toBe("explicit-model");
  });

  it("anahtar yokken hata fırlatır (mevcut davranış)", async () => {
    mockFetchReturning("asla");
    await expect(chatCompletion("selam")).rejects.toThrow(
      "META_API_KEY is not set",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hic cevap vermeyen ucta kisa timeout ile reddeder (AbortSignal fetch'e gider)", async () => {
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
      chatCompletion("selam", { timeoutMs: 20 }),
    ).rejects.toThrow();
    const [, init] = fetchMock.mock.calls[0] as [string, { signal?: unknown }];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("GLIMMER_TIMEOUT_MS env'i Glimmer cagrisina kisa timeout olarak yansir", async () => {
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

    await expect(glimmerChat("özetle")).rejects.toThrow();
  });
});

describe("varsayılan istemci bağlantıları", () => {
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

  it("rerank varsayılan istemcisi Spark katmanını kullanır", async () => {
    process.env.BASETEN_API_KEY = "baseten-key";
    process.env.BASETEN_API_URL = "https://baseten.example/v1/chat/completions";
    process.env.SPARK_MODEL = "spark-model";
    const candidate = makeCase({ id: "case-a", summary: "su kenarında saldırı" });
    const query = makeCase({ id: "query", summary: "su kenarında saldırı" });
    mockFetchReturning(
      JSON.stringify([
        { caseId: "case-a", score: 9, reason: "çok benzer", quote: candidate.summary },
      ]),
    );

    const ranked = await rerank([candidate], query);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(9);
    const { url, body } = lastCall();
    expect(url).toBe("https://baseten.example/v1/chat/completions");
    expect(body.model).toBe("spark-model");
  });

  it("fieldBrief varsayılan istemcisi Glimmer katmanını kullanır", async () => {
    process.env.GLIMMER_API_KEY = "glimmer-key";
    process.env.GLIMMER_API_URL = "https://glimmer.example/v1/chat/completions";
    process.env.GLIMMER_MODEL = "glimmer-model";
    mockFetchReturning("Tek cümle özet.");
    const entries = [
      { type: "transcript", note: "gece beyaz arabayı gördüm" },
    ] as Parameters<typeof fieldBrief>[0];

    await expect(fieldBrief(entries)).resolves.toBe("Tek cümle özet.");

    const { url, body } = lastCall();
    expect(url).toBe("https://glimmer.example/v1/chat/completions");
    expect(body.model).toBe("glimmer-model");
  });
});
