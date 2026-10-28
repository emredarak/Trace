import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { prefilter } from "../lib/prefilter";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("prefilter", () => {
  it("returns the right 2 candidates with matchedFields from 3 fixtures for waterfront + bladed features", () => {
    const a = insertCase({
      summary: "waterfront stabbing attack",
      crimeType: "homicide",
      locationType: "waterfront",
      weapon: "sharp object",
      mo: "night approach",
    });
    const b = insertCase({
      summary: "waterfront gunfight",
      crimeType: "assault",
      locationType: "waterfront",
      weapon: "pistol",
    });
    insertCase({
      summary: "downtown armed robbery",
      crimeType: "robbery",
      locationType: "city center",
      weapon: "pistol",
      mo: "daytime threat",
    });

    const candidates = prefilter(getDb(), {
      locationType: "waterfront",
      weapon: "sharp",
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

  it("returns an empty list for empty features", () => {
    insertCase({ summary: "waterfront incident", locationType: "waterfront" });
    expect(prefilter(getDb(), {})).toEqual([]);
  });

  it("applies the default limit of 20 and honors a custom limit", () => {
    for (let i = 0; i < 25; i++) {
      insertCase({
        summary: `waterfront case ${i}`,
        locationType: "waterfront",
      });
    }
    const all = prefilter(getDb(), { locationType: "waterfront" });
    expect(all).toHaveLength(20);
    const five = prefilter(getDb(), { locationType: "waterfront" }, 5);
    expect(five).toHaveLength(5);
  });
});
