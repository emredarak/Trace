import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, initDb } from "../lib/db";
import { GET as listCases, POST as createCase } from "../app/api/cases/route";
import { GET as getSimilar } from "../app/api/cases/[id]/similar/route";

// Gerçek zincir: POST /api/cases -> prefilter -> GET /api/cases/[id]/similar.
// Yalnızca Meta istemcisi sahte: aday kimliklerini prompt'tan okuyup
// listeleme sırasına göre azalan puan verir.
vi.mock("../lib/meta-client", () => ({
  chatCompletion: async (prompt: string) => {
    const ids = [...prompt.matchAll(/^-\s*id:\s*(\S+)/gm)].map((m) => m[1]);
    const unique = [...new Set(ids)];
    return JSON.stringify(
      unique.map((caseId, i) => ({
        caseId,
        score: Math.max(1, 10 - i),
        reason: "demo: su kenarı bıçaklı gece MO eşleşmesi",
        quote: "demo alıntı",
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

// Tohum arşivindeki 5'li seri kümesiyle aynı MO'yu paylaşan yeni sorgu vakası.
const QUERY_CASE = {
  summary:
    "[Kurgu] Gece göl kıyısında olta takımları çalındı; mağdur arkadan yaklaşan bıçaklı şüpheliyi tarif etti.",
  crimeType: "hırsızlık",
  locationType: "su kenarı",
  locationText: "demo göl kıyısı, 4 No'lu iskele (kurgu adres)",
  occurredAt: "2026-08-02T23:30:00",
  officer: "Demo Memur (kurgu)",
  victimAge: 40,
  victimGender: "erkek",
  suspects: "kimliği belirsiz erkek (kurgu)",
  witnesses: "yok",
  mo: "gece arkadan yaklaşma, olta takımı çalma",
  weapon: "bıçak",
  status: "open",
};

function isClusterMember(c: Record<string, unknown>): boolean {
  return (
    c.locationType === "su kenarı" &&
    c.weapon === "bıçak" &&
    c.mo === "gece arkadan yaklaşma, olta takımı çalma"
  );
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

describe("demo provası: kayıt -> ön filtre -> sahte yeniden sıralama -> liste", () => {
  it("yeni sorgu vakası seri kümesinden en az 2 sonuç döndürür", async () => {
    // Fixture: 32 kurgu vakalık tohum arşivini gerçek API üzerinden yükle.
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
        score: number;
        reason: string;
        quote: string;
        matchedFields: string[];
      }[];
      fresh: boolean;
    };

    expect(Array.isArray(body.results)).toBe(true);
    const hits = body.results.filter((r) => clusterIds.has(r.caseId));
    expect(hits.length).toBeGreaterThanOrEqual(2);

    for (const r of body.results) {
      expect(r.caseId).not.toBe(query.id);
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(10);
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(r.quote.trim().length).toBeGreaterThan(0);
      expect(r.matchedFields.length).toBeGreaterThan(0);
    }
    expect(hits[0].matchedFields).toContain("weapon");
    expect(typeof body.fresh).toBe("boolean");
  });
});
