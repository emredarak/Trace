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
  summary: "night theft at the waterfront",
  crimeType: "theft",
  locationType: "waterfront",
  weapon: "knife",
  mo: "night approach",
});

function sixCases(): CaseRecord[] {
  return [1, 2, 3, 4, 5, 6].map((n) =>
    makeCase({
      id: `case-${n}`,
      summary: `waterfront night case ${n}`,
      crimeType: "theft",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    }),
  );
}

describe("rerankWithTimeout", () => {
  it("uses the 15s default timeout", () => {
    expect(RERANK_TIMEOUT_MS).toBe(15_000);
  });

  it("slow client times out and falls back to an unscored list, no loss (first 5)", async () => {
    const cases = sixCases();
    const slow = {
      chatCompletion: async (_prompt: string) =>
        new Promise<string>(() => {
    // Never resolves: mimics a hanging model client.
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
