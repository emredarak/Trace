import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { prefilter } from "../lib/prefilter";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("prefilter", () => {
  it("su kenarı + kesici özellikleri 3 kurgu vaka içinden doğru 2 adayı matchedFields ile döndürür", () => {
    const a = insertCase({
      summary: "su kenarında kesici aletle saldırı",
      crimeType: "cinayet",
      locationType: "su kenarı",
      weapon: "kesici alet",
      mo: "gece yaklaşma",
    });
    const b = insertCase({
      summary: "su kenarında tabancalı kavga",
      crimeType: "yaralama",
      locationType: "su kenarı",
      weapon: "tabanca",
    });
    insertCase({
      summary: "şehir merkezinde tabancalı soygun",
      crimeType: "gasp",
      locationType: "şehir merkezi",
      weapon: "tabanca",
      mo: "gündüz tehdit",
    });

    const candidates = prefilter(getDb(), {
      locationType: "su kenarı",
      weapon: "kesici",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].caseId).toBe(a.id);
    expect([...candidates[0].matchedFields].sort()).toEqual([
      "locationType",
      "weapon",
    ]);
    const bCandidate = candidates.find((c) => c.caseId === b.id);
    expect(bCandidate).toBeDefined();
    expect(bCandidate?.matchedFields).toEqual(["locationType"]);
  });

  it("boş özelliklerde boş liste döndürür", () => {
    insertCase({ summary: "su kenarında olay", locationType: "su kenarı" });
    expect(prefilter(getDb(), {})).toEqual([]);
  });

  it("varsayılan limiti 20 uygular ve özel limiti dikkate alır", () => {
    for (let i = 0; i < 25; i++) {
      insertCase({
        summary: `su kenarı vaka ${i}`,
        locationType: "su kenarı",
      });
    }
    const all = prefilter(getDb(), { locationType: "su kenarı" });
    expect(all).toHaveLength(20);
    const five = prefilter(getDb(), { locationType: "su kenarı" }, 5);
    expect(five).toHaveLength(5);
  });
});
