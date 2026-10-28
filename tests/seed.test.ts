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
  it("contains at least 18 fictional cases", () => {
    expect(loadSeed().length).toBeGreaterThanOrEqual(18);
  });

  it("all records have non-empty summary, crimeType, locationType", () => {
    for (const c of loadSeed()) {
      for (const field of ["summary", "crimeType", "locationType"]) {
        expect(typeof c[field]).toBe("string");
        expect((c[field] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("every record is explicitly marked fictional (TR-SEED-* + [Fiction] prefix)", () => {
    for (const c of loadSeed()) {
      expect(c.caseNo).toMatch(/^TR-SEED-/);
      expect(c.summary).toMatch(/^\[Fiction\]/);
    }
  });

  it("waterfront / forest / residence split is balanced", () => {
    const counts: Record<string, number> = {};
    for (const c of loadSeed()) {
      const loc = c.locationType as string;
      counts[loc] = (counts[loc] ?? 0) + 1;
    }
    for (const loc of ["waterfront", "forest", "residence"]) {
      expect(counts[loc] ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("at least 2 serial sets share the same MO+weapon+locationType (3+ members)", () => {
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
  it("loads via POST /api/cases", () => {
    expect(existsSync(SCRIPT_PATH)).toBe(true);
    const src = readFileSync(SCRIPT_PATH, "utf-8");
    expect(src).toContain("/api/cases");
    expect(src).toMatch(/fetch|POST/);
    expect(src).toContain("cases.json");
  });

  it("seed data registers 201 via the real API", async () => {
    const seed = loadSeed();
    for (const c of seed) {
      const { caseNo: _drop, ...input } = c;
      const res = await createCase(postRequest(input));
      expect(res.status).toBe(201);
    }
  });
});
