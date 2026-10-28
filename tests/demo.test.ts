import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, initDb } from "../lib/db";
import { GET as listCases, POST as createCase } from "../app/api/cases/route";
import { GET as getSimilar } from "../app/api/cases/[id]/similar/route";

// Real chain: POST /api/cases -> dossier/prefilter -> GET /api/cases/[id]/similar.
// Only the Meta client is faked: it reads candidate IDs from the Spark prompt's
// case-file headers (first header is the query case) and scores them
// in listing order, descending.
vi.mock("../lib/meta-client", () => ({
  chatCompletion: async (prompt: string) => {
    const ids = [...prompt.matchAll(/Case \S+ \(id: ([^,]+),/g)].map((m) => m[1]);
    const unique = [...new Set(ids)].slice(1);
    return JSON.stringify(
      unique.map((caseId, i) => ({
        caseId,
        score: Math.max(1, 10 - i),
        reason: "demo: waterfront knife night MO match",
        similarities: [
          { kind: "weapon", description: "knife in both", strength: 9, evidence: "knife" },
          { kind: "method", description: "approaching from behind at night", strength: 8, evidence: "approaching from behind at night" },
        ],
      })),
    );
  },
}));

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// New query case sharing the same MO as the 5-case serial set in the seed archive.
const QUERY_CASE = {
  summary:
    "[Fiction] At night fishing gear was stolen on the lake shore; the victim described a suspect with a knife approaching from behind.",
  crimeType: "theft",
  locationType: "waterfront",
  locationText: "demo lake shore, Pier 4 (fictional address)",
  occurredAt: "2026-08-02T23:30:00",
  officer: "Demo Officer (fictional)",
  victimAge: 40,
  victimGender: "male",
  suspects: "unidentified man (fictional)",
  witnesses: "none",
  mo: "approaching from behind at night, stealing fishing gear",
  weapon: "knife",
  status: "open",
};

function isClusterMember(c: Record<string, unknown>): boolean {
  return (
    c.locationType === "waterfront" &&
    c.weapon === "knife" &&
    c.mo === "approaching from behind at night, stealing fishing gear"
  );
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("demo rehearsal: record -> prefilter -> fake rerank -> list", () => {
  it("new query case returns at least 2 results from the serial set", async () => {
    // Fixture: load the 18-case fictional seed archive via the real API.
    const seedDir = dirname(fileURLToPath(import.meta.url));
    const seed = JSON.parse(
      readFileSync(join(seedDir, "..", "seed", "cases.json"), "utf-8"),
    ) as Record<string, unknown>[];
    for (const record of seed) {
      const { caseNo: _drop, ...input } = record;
      const res = await createCase(postRequest(input));
      expect(res.status).toBe(201);
    }

    const query: { id: string; caseNo: string } = await (
      await createCase(postRequest(QUERY_CASE))
    ).json();

    const list = (await (await listCases()).json()) as Record<string, unknown>[];
    const clusterIds = new Set(
      list.filter(isClusterMember).map((c) => c.id as string),
    );

    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${query.id}/similar`),
      { params: Promise.resolve({ id: query.id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: {
        caseId: string;
        caseNo: string;
        score: number;
        reason: string;
        similarities: { kind: string; description: string; strength: number; evidence: string }[];
      }[];
      fresh: boolean;
      limit: number;
    };

    expect(Array.isArray(body.results)).toBe(true);
    const hits = body.results.filter((r) => clusterIds.has(r.caseId));
    expect(hits.length).toBeGreaterThanOrEqual(2);

    for (const r of body.results) {
      expect(r.caseId).not.toBe(query.id);
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(10);
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(typeof r.caseNo).toBe("string");
      expect(r.caseNo.length).toBeGreaterThan(0);
      expect(r.similarities.length).toBeGreaterThan(0);
    }
    expect(hits[0].similarities.map((s) => s.kind)).toContain("weapon");
    expect(body.limit).toBe(5);
    expect(typeof body.fresh).toBe("boolean");
  });
});
