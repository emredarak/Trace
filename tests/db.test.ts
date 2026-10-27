import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("case database", () => {
  it("creates cases, evidences and case_fts tables", () => {
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('cases', 'evidences', 'case_fts') ORDER BY name",
      )
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "case_fts",
      "cases",
      "evidences",
    ]);
  });

  it("saves a minimal CaseInput with only summary and auto-generates caseNo/createdAt", () => {
    const rec = insertCase({ summary: "x" });
    expect(rec.summary).toBe("x");
    expect(rec.id).toBeTruthy();
    expect(rec.caseNo).toMatch(/^TR-\d{4}$/);
    expect(rec.createdAt).toBeTruthy();
  });

  it("increments caseNo sequentially", () => {
    const a = insertCase({ summary: "a" });
    const b = insertCase({ summary: "b" });
    expect(a.caseNo).toBe("TR-0001");
    expect(b.caseNo).toBe("TR-0002");
  });

  it("rejects input without a non-empty summary", () => {
    expect(() => insertCase({} as never)).toThrow();
    expect(() => insertCase({ summary: "" })).toThrow();
    expect(() => insertCase({ summary: "   " })).toThrow();
  });

  it("stores optional schema fields", () => {
    const rec = insertCase({
      summary: "su kenarında olay",
      crimeType: "cinayet",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    });
    expect(rec.crimeType).toBe("cinayet");
    expect(rec.locationType).toBe("su kenarı");
    expect(rec.weapon).toBe("bıçak");
    expect(rec.mo).toBe("gece yaklaşma");
  });

  it("indexes searchable fields in case_fts", () => {
    insertCase({
      summary: "su kenarında kesici alet olayı",
      crimeType: "cinayet",
      locationType: "su kenarı",
      weapon: "bıçak",
      mo: "gece yaklaşma",
    });
    const db = getDb();
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM case_fts WHERE case_fts MATCH 'bıçak'")
      .get() as { n: number };
    expect(row.n).toBe(1);
  });

  it("writes location title/kind/priority and mirrors note into locationText", () => {
    const rec = insertCase({
      summary: "konumlu vaka",
      locations: [
        {
          title: "Olay evi",
          note: "kapı zorlanmış",
          kind: "olay-yeri",
          priority: "kritik",
          latitude: 41.01,
          longitude: 28.97,
        },
        { locationText: "köprü altı" },
      ],
    });
    initDb();
    const rows = getDb()
      .prepare(
        "SELECT title, note, locationText, kind, priority FROM case_locations WHERE caseId = ? ORDER BY rowid ASC",
      )
      .all(rec.id) as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        title: "Olay evi",
        note: "kapı zorlanmış",
        locationText: "kapı zorlanmış",
        kind: "olay-yeri",
        priority: null,
      },
      {
        title: "köprü altı",
        note: null,
        locationText: null,
        kind: "iliskili",
        priority: null,
      },
    ]);
  });

  it("links evidence rows to their case", () => {
    const db = getDb();
    const rec = insertCase({ summary: "delilli vaka" });
    db.prepare(
      "INSERT INTO evidences (id, caseId, type, note, createdAt) VALUES (?, ?, ?, ?, ?)",
    ).run("ev-1", rec.id, "note", "kısa not", rec.createdAt);
    const row = db
      .prepare("SELECT caseId, type FROM evidences WHERE id = 'ev-1'")
      .get() as { caseId: string; type: string };
    expect(row).toEqual({ caseId: rec.id, type: "note" });
  });
});
