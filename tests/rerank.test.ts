import { describe, expect, it } from "vitest";
import type { CaseRecord } from "../lib/case-schema";
import { rerank } from "../lib/rerank";

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
  summary: "night stabbing at the waterfront",
  crimeType: "homicide",
  locationType: "waterfront",
  weapon: "sharp object",
  mo: "night approach",
});

function threeCases(): CaseRecord[] {
  return [
    makeCase({
      id: "case-a",
      summary: "waterfront stabbing attack",
      crimeType: "robbery",
      locationType: "waterfront",
      weapon: "sharp object",
      mo: "daytime threat",
    }),
    makeCase({
      id: "case-b",
      summary: "waterfront gunfight",
      crimeType: "assault",
      locationType: "waterfront",
      weapon: "pistol",
    }),
    makeCase({
      id: "case-c",
      summary: "downtown knife homicide",
      crimeType: "homicide",
      locationType: "city center",
      weapon: "pistol",
    }),
  ];
}

describe("rerank", () => {
  it("orders 3 candidates by score with a fake client; every item has score, reason, quote, matchedFields filled", async () => {
    const [a, b, c] = threeCases();
    let seenPrompt = "";
    const fake = {
      chatCompletion: async (prompt: string) => {
        seenPrompt = prompt;
        return JSON.stringify([
          { caseId: b.id, score: 6, reason: "location matches", quote: b.summary },
          { caseId: a.id, score: 9, reason: "location and weapon match", quote: a.summary },
          { caseId: c.id, score: 3, reason: "only crime type matches", quote: c.summary },
        ]);
      },
    };

    const ranked = await rerank([a, b, c], query, fake);

    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.caseId)).toEqual([a.id, b.id, c.id]);
    for (const r of ranked) {
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(10);
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(r.quote.trim().length).toBeGreaterThan(0);
      expect(r.matchedFields.length).toBeGreaterThan(0);
    }
    expect(ranked[0].matchedFields).toEqual(["locationType", "weapon"]);
    expect(seenPrompt).toContain(query.summary);
    expect(seenPrompt).toContain(a.summary);
  });

  it("lists candidates unscored without loss on malformed model responses", async () => {
    const [a, b, c] = threeCases();
    const fake = {
      chatCompletion: async (_prompt: string) => "broken response {{{",
    };

    const ranked = await rerank([a, b, c], query, fake);

    expect(ranked.map((r) => r.caseId)).toEqual([a.id, b.id, c.id]);
    expect(ranked[0].matchedFields).toEqual(["locationType", "weapon"]);
    expect(ranked[0].quote).toBe(a.summary);
  });

  it("lists candidates unscored without loss on client errors", async () => {
    const [a, b, c] = threeCases();
    const fake = {
      chatCompletion: async (_prompt: string) => {
        throw new Error("network down");
      },
    };

    const ranked = await rerank([a, b, c], query, fake);

    expect(ranked.map((r) => r.caseId)).toEqual([a.id, b.id, c.id]);
  });

  it("malformed-response fallback limited to the first 5 (first 5 of 6 candidates)", async () => {
    const base = threeCases();
    const extra = [4, 5, 6].map((n) =>
      makeCase({
        id: `case-x${n}`,
        summary: `waterfront case ${n}`,
        locationType: "waterfront",
      }),
    );
    const all = [...base, ...extra];
    const fake = {
      chatCompletion: async (_prompt: string) => "broken response {{{",
    };

    const ranked = await rerank(all, query, fake);

    expect(ranked).toHaveLength(5);
    expect(ranked.map((r) => r.caseId)).toEqual(
      all.slice(0, 5).map((c) => c.id),
    );
    for (const r of ranked) {
      expect(r.score).toBe(0);
      expect(r.quote.trim().length).toBeGreaterThan(0);
    }
  });

  it("returns the first 5 (top 5 of 6 candidates by score)", async () => {
    const base = threeCases();
    const extra = [4, 5, 6].map((n) =>
      makeCase({
        id: `case-x${n}`,
        summary: `waterfront case ${n}`,
        locationType: "waterfront",
      }),
    );
    const all = [...base, ...extra];
    const scores = [4, 9, 2, 7, 6, 8];
    const fake = {
      chatCompletion: async (_prompt: string) =>
        JSON.stringify(
          all.map((c, i) => ({
            caseId: c.id,
            score: scores[i],
            reason: `reason ${i}`,
            quote: c.summary,
          })),
        ),
    };

    const ranked = await rerank(all, query, fake);

    expect(ranked).toHaveLength(5);
    expect(ranked.map((r) => r.score)).toEqual([9, 8, 7, 6, 4]);
  });
});
