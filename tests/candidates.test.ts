import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier, type CaseDossier } from "../lib/dossier";
import { findCandidates } from "../lib/candidates";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

const noGlimmer = { summarize: async () => "ozet" };

let seq = 0;
function addLocation(caseId: string, latitude: number, longitude: number) {
  seq += 1;
  getDb()
    .prepare(
      "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(`loc-t${seq}`, caseId, "Konum", null, null, "olay-yeri", null, latitude, longitude, new Date().toISOString());
}
function addPerson(caseId: string, name: string | null, type: string, unidentified = false) {
  seq += 1;
  getDb()
    .prepare(
      "INSERT INTO case_persons (id, caseId, name, type, unidentified, createdAt) VALUES (?,?,?,?,?,?)",
    )
    .run(`per-t${seq}`, caseId, name, type, unidentified ? 1 : 0, new Date().toISOString());
}
function addSamEvidence(caseId: string, labels: string[]) {
  seq += 1;
  const marking = JSON.stringify({
    boxes: labels.map((label, i) => ({ x: 0.1 * i, y: 0.1, w: 0.2, h: 0.2, label })),
  });
  getDb()
    .prepare(
      "INSERT INTO evidences (id, caseId, type, title, note, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(`ev-t${seq}`, caseId, "evidence", "Delil", null, null, marking, new Date().toISOString());
}

async function dossiersFor(ids: string[]): Promise<CaseDossier[]> {
  const out: CaseDossier[] = [];
  for (const id of ids) out.push(await buildDossier(getDb(), id, noGlimmer));
  return out;
}

describe("findCandidates", () => {
  it("FTS'nin kacirdigi vakalari konum/kişi/nesne/zaman kanallarinin her birinden yakalar", async () => {
    const query = insertCase({
      summary: "sorgu essizkelime olayi",
      occurredAt: "2026-01-15T12:00:00.000Z",
    });
    addLocation(query.id, 41.0082, 28.9784);
    addPerson(query.id, "AHMET YILMAZ", "supheli");
    addSamEvidence(query.id, ["Beyaz Araç"]);

    const byLocation = insertCase({ summary: "tamamen farkli anlatim bir", occurredAt: "2024-01-01T12:00:00.000Z" });
    addLocation(byLocation.id, 41.01, 28.98); // ~250 m

    const byPerson = insertCase({ summary: "tamamen farkli anlatim iki", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(byPerson.id, "ahmet yılmaz", "supheli");

    const byObject = insertCase({ summary: "tamamen farkli anlatim uc", occurredAt: "2024-01-01T12:00:00.000Z" });
    addSamEvidence(byObject.id, ["beyaz arac"]);

    const byTime = insertCase({ summary: "tamamen farkli anlatim dort", occurredAt: "2026-03-01T12:00:00.000Z" });

    const far = insertCase({ summary: "tamamen farkli anlatim bes", occurredAt: "2024-06-01T12:00:00.000Z" });
    addLocation(far.id, 39.9334, 32.8597); // Ankara, >5 km
    addPerson(far.id, "Baska Kisi", "supheli");
    addSamEvidence(far.id, ["kirmizi motor"]);

    const dossiers = await dossiersFor([query.id, byLocation.id, byPerson.id, byObject.id, byTime.id, far.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    const byId = new Map(result.map((r) => [r.caseId, r.channels]));

    expect(byId.get(byLocation.id)).toEqual(["location"]);
    expect(byId.get(byPerson.id)).toEqual(["person"]);
    expect(byId.get(byObject.id)).toEqual(["object"]);
    expect(byId.get(byTime.id)).toEqual(["time"]);
    expect(byId.has(far.id)).toBe(false);
    expect(byId.has(query.id)).toBe(false);
  });

  it("metin (FTS) kanalini da adaylara isler", async () => {
    const query = insertCase({ summary: "sorgu metni", crimeType: "cinayet", weapon: "kesici alet" });
    const hit = insertCase({ summary: "baska anlatim", crimeType: "cinayet", weapon: "kesici alet" });
    const dossiers = await dossiersFor([query.id, hit.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.find((r) => r.caseId === hit.id)?.channels).toContain("text");
  });

  it("kimligi belirsiz kisi ad kanalindan aday uretmez; ayni ad farkli rol de uretmez", async () => {
    const query = insertCase({ summary: "sorgu essizkelime", occurredAt: "2026-01-15T12:00:00.000Z" });
    addPerson(query.id, "Mehmet Kaya", "supheli");
    addPerson(query.id, "Gizli Kisi", "supheli", true);

    const unidentifiedMatch = insertCase({ summary: "farkli anlatim x", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(unidentifiedMatch.id, "gizli kisi", "supheli", true);

    const roleMismatch = insertCase({ summary: "farkli anlatim y", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(roleMismatch.id, "MEHMET KAYA", "tanik");

    const identified = insertCase({ summary: "farkli anlatim z", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(identified.id, "Mehmet Kaya", "supheli", true); // candidate tarafi da belirsizse uretmez

    const dossiers = await dossiersFor([query.id, unidentifiedMatch.id, roleMismatch.id, identified.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.map((r) => r.caseId)).not.toContain(unidentifiedMatch.id);
    expect(result.map((r) => r.caseId)).not.toContain(roleMismatch.id);
    expect(result.map((r) => r.caseId)).not.toContain(identified.id);
  });

  it("turkce buyuk/kucuk harf ve karakter farklarini kisi ve nesne kanalinda normalize eder", async () => {
    const query = insertCase({ summary: "sorgu essizkelime", occurredAt: "2026-01-15T12:00:00.000Z" });
    addPerson(query.id, "İbrahim IŞIK", "supheli");
    addSamEvidence(query.id, ["BIÇAK"]);

    const cand = insertCase({ summary: "farkli anlatim q", occurredAt: "2024-01-01T12:00:00.000Z" });
    addPerson(cand.id, "ibrahim isik", "supheli");
    addSamEvidence(cand.id, ["bicak"]);

    const dossiers = await dossiersFor([query.id, cand.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.find((r) => r.caseId === cand.id)?.channels).toEqual(
      expect.arrayContaining(["person", "object"]),
    );
  });

  it("kapali vakalar aday havuzundadir, sorgu vaka harictir", async () => {
    const query = insertCase({ summary: "sorgu essizkelime", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0082, 28.9784);
    const closed = insertCase({ summary: "farkli anlatim kapali", occurredAt: "2024-01-01T12:00:00.000Z", status: "closed" });
    addLocation(closed.id, 41.009, 28.979);

    const dossiers = await dossiersFor([query.id, closed.id]);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result.map((r) => r.caseId)).toContain(closed.id);
    expect(result.map((r) => r.caseId)).not.toContain(query.id);
  });

  it("zaman penceresi 90 gun: icindeki dahil, disindaki haric; 5 km disi konum haric", async () => {
    const query = insertCase({ summary: "sorgu essizkelime", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0, 29.0);
    const inTime = insertCase({ summary: "farkli anlatim t1", occurredAt: "2026-04-10T12:00:00.000Z" }); // 85 gun
    const outTime = insertCase({ summary: "farkli anlatim t2", occurredAt: "2026-05-01T12:00:00.000Z" }); // 106 gun
    const farLoc = insertCase({ summary: "farkli anlatim t3", occurredAt: "2024-01-01T12:00:00.000Z" });
    addLocation(farLoc.id, 41.07, 29.0); // ~7.8 km

    const dossiers = await dossiersFor([query.id, inTime.id, outTime.id, farLoc.id]);
    const ids = findCandidates(getDb(), query.id, dossiers).map((r) => r.caseId);
    expect(ids).toContain(inTime.id);
    expect(ids).not.toContain(outTime.id);
    expect(ids).not.toContain(farLoc.id);
  });

  it("toplam 20 siniri ve cok kanalli onceligi uygular", async () => {
    const query = insertCase({ summary: "sorgu essizkelime", occurredAt: "2026-01-15T12:00:00.000Z" });
    addLocation(query.id, 41.0082, 28.9784);
    addPerson(query.id, "Ahmet Yilmaz", "supheli");

    const ids: string[] = [query.id];
    // 24 tek kanalli (yalniz zaman) aday
    for (let i = 0; i < 24; i++) {
      const c = insertCase({ summary: `benzersiz${i} anlatim`, occurredAt: "2026-02-01T12:00:00.000Z" });
      ids.push(c.id);
    }
    const multi = insertCase({ summary: "cokkanal benzersiz", occurredAt: "2026-02-01T12:00:00.000Z" });
    addLocation(multi.id, 41.009, 28.979);
    addPerson(multi.id, "ahmet yilmaz", "supheli");
    ids.push(multi.id);

    const dossiers = await dossiersFor(ids);
    const result = findCandidates(getDb(), query.id, dossiers);
    expect(result).toHaveLength(20);
    expect(result[0].caseId).toBe(multi.id);
    expect(result[0].channels.length).toBeGreaterThanOrEqual(3);
    // Siralama: kanal sayisi azalmayan sira
    const counts = result.map((r) => r.channels.length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});
