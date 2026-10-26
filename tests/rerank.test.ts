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
  summary: "su kenarında kesici aletle gece saldırısı",
  crimeType: "cinayet",
  locationType: "su kenarı",
  weapon: "kesici alet",
  mo: "gece yaklaşma",
});

function threeCases(): CaseRecord[] {
  return [
    makeCase({
      id: "case-a",
      summary: "su kenarında kesici aletle saldırı",
      crimeType: "gasp",
      locationType: "su kenarı",
      weapon: "kesici alet",
      mo: "gündüz tehdit",
    }),
    makeCase({
      id: "case-b",
      summary: "su kenarında tabancalı kavga",
      crimeType: "yaralama",
      locationType: "su kenarı",
      weapon: "tabanca",
    }),
    makeCase({
      id: "case-c",
      summary: "şehir merkezinde bıçaklı cinayet",
      crimeType: "cinayet",
      locationType: "şehir merkezi",
      weapon: "tabanca",
    }),
  ];
}

describe("rerank", () => {
  it("sahte istemciyle 3 adayı puan sırasına dizer; her maddede score, reason, quote, matchedFields dolu", async () => {
    const [a, b, c] = threeCases();
    let seenPrompt = "";
    const fake = {
      chatCompletion: async (prompt: string) => {
        seenPrompt = prompt;
        return JSON.stringify([
          { caseId: b.id, score: 6, reason: "konum uyuyor", quote: b.summary },
          { caseId: a.id, score: 9, reason: "konum ve silah uyuyor", quote: a.summary },
          { caseId: c.id, score: 3, reason: "sadece suç türü uyuyor", quote: c.summary },
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

  it("bozuk model yanıtında adayları puansız listeler, kayıp olmaz", async () => {
    const [a, b, c] = threeCases();
    const fake = {
      chatCompletion: async (_prompt: string) => "bozuk yanıt {{{",
    };

    const ranked = await rerank([a, b, c], query, fake);

    expect(ranked.map((r) => r.caseId)).toEqual([a.id, b.id, c.id]);
    expect(ranked[0].matchedFields).toEqual(["locationType", "weapon"]);
    expect(ranked[0].quote).toBe(a.summary);
  });

  it("istemci hatasında adayları puansız listeler, kayıp olmaz", async () => {
    const [a, b, c] = threeCases();
    const fake = {
      chatCompletion: async (_prompt: string) => {
        throw new Error("network down");
      },
    };

    const ranked = await rerank([a, b, c], query, fake);

    expect(ranked.map((r) => r.caseId)).toEqual([a.id, b.id, c.id]);
  });

  it("bozuk yanıtta geri dönüş ilk 5 ile sınırlıdır (6 adaydan ilk 5)", async () => {
    const base = threeCases();
    const extra = [4, 5, 6].map((n) =>
      makeCase({
        id: `case-x${n}`,
        summary: `su kenarında vaka ${n}`,
        locationType: "su kenarı",
      }),
    );
    const all = [...base, ...extra];
    const fake = {
      chatCompletion: async (_prompt: string) => "bozuk yanıt {{{",
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

  it("ilk 5'i döndürür (6 adaydan en yüksek puanlı 5)", async () => {
    const base = threeCases();
    const extra = [4, 5, 6].map((n) =>
      makeCase({
        id: `case-x${n}`,
        summary: `su kenarında vaka ${n}`,
        locationType: "su kenarı",
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
            reason: `gerekçe ${i}`,
            quote: c.summary,
          })),
        ),
    };

    const ranked = await rerank(all, query, fake);

    expect(ranked).toHaveLength(5);
    expect(ranked.map((r) => r.score)).toEqual([9, 8, 7, 6, 4]);
  });
});
