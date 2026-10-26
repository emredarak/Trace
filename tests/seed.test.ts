import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { closeDb, initDb } from "../lib/db";
import { POST as createCase } from "../app/api/cases/route";

const SEED_PATH = join(__dirname, "..", "seed", "cases.json");
const SCRIPT_PATH = join(__dirname, "..", "seed", "seed.ts");

function loadSeed(): Record<string, unknown>[] {
  const raw = readFileSync(SEED_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  expect(Array.isArray(parsed)).toBe(true);
  return parsed as Record<string, unknown>[];
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("seed/cases.json", () => {
  it("en az 30 kurgu vaka içerir", () => {
    expect(loadSeed().length).toBeGreaterThanOrEqual(30);
  });

  it("tüm kayıtlarda summary, crimeType, locationType dolu", () => {
    for (const c of loadSeed()) {
      for (const field of ["summary", "crimeType", "locationType"]) {
        expect(typeof c[field]).toBe("string");
        expect((c[field] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("her kayıt açıkça kurgu işaretli (TR-SEED-* + [Kurgu] öneki)", () => {
    for (const c of loadSeed()) {
      expect(c.caseNo).toMatch(/^TR-SEED-/);
      expect(c.summary).toMatch(/^\[Kurgu\]/);
    }
  });

  it("su kenarı / orman / ev içi dağılımı dengeli", () => {
    const counts: Record<string, number> = {};
    for (const c of loadSeed()) {
      const loc = c.locationType as string;
      counts[loc] = (counts[loc] ?? 0) + 1;
    }
    for (const loc of ["su kenarı", "orman", "ev içi"]) {
      expect(counts[loc] ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("en az 2 seri kümesi aynı MO+weapon+locationType paylaşır (3+ üye)", () => {
    const groups = new Map<string, number>();
    for (const c of loadSeed()) {
      const key = `${c.locationType}|${c.weapon}|${c.mo}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const clusters = [...groups.values()].filter((n) => n >= 3);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });
});

describe("seed/seed.ts", () => {
  it("POST /api/cases üzerinden yükler", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    const src = readFileSync(SCRIPT_PATH, "utf-8");
    expect(src).toContain("/api/cases");
    expect(src).toMatch(/fetch|POST/);
    expect(src).toContain("cases.json");
  });

  it("seed verisi gerçek API üzerinden 201 ile kaydolur", async () => {
    const seed = loadSeed();
    for (const c of seed) {
      const { caseNo: _drop, ...input } = c;
      const res = await createCase(postRequest(input));
      expect(res.status).toBe(201);
    }
  });
});
