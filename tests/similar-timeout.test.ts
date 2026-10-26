import { describe, expect, it } from "vitest";
import type { CaseRecord } from "../lib/case-schema";
import {
  RERANK_TIMEOUT_MS,
  rerankWithTimeout,
} from "../lib/rerank";

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

const query = makeCase({
  id: "query",
  summary: "su kenarında gece hırsızlık olayı",
  crimeType: "hırsızlık",
  locationType: "su kenarı",
  weapon: "bıçak",
  mo: "gece yaklaşma",
});

function sixCases(): CaseRecord[] {
  return [1, 2, 3, 4, 5, 6].map((n) =>
    makeCase({
      id: `case-${n}`,
      summary: `su kenarında gece vaka ${n}`,
      crimeType: "hırsızlık",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    }),
  );
}

describe("rerankWithTimeout", () => {
  it("15 sn varsayılan zaman aşımı kullanır", () => {
    expect(RERANK_TIMEOUT_MS).toBe(15_000);
  });

  it("yavaş istemcide zaman aşımına uğrayıp puansız listeye düşer, kayıp olmaz (ilk 5)", async () => {
    const cases = sixCases();
    const slow = {
      chatCompletion: async (_prompt: string) =>
        new Promise<string>(() => {
          // Hiç çözülmez: asılı model istemcisini taklit eder.
        }),
    };

    const ranked = await rerankWithTimeout(cases, query, slow, 20);

    expect(ranked).toHaveLength(5);
    expect(ranked.map((r) => r.caseId)).toEqual(
      cases.slice(0, 5).map((c) => c.id),
    );
    for (const r of ranked) {
      expect(r.score).toBe(0);
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(r.quote.trim().length).toBeGreaterThan(0);
    }
  });
});
