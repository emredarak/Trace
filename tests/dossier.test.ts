import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";
import { buildDossier, dossierText } from "../lib/dossier";

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  closeDb();
  initDb();
});

const fakeGlimmer = {
  summarize: vi.fn(async (prompt: string) =>
    prompt.includes("beyaz araci gordum")
      ? "Supheli beyaz aracla kactigini anlatti."
      : "Transkript ozeti.",
  ),
};

function seedFullCase() {
  const rec = insertCase({
    summary: "Gece market onunde bicakli saldiri",
    crimeType: "yaralama",
    weapon: "bicak",
    mo: "gece yaklasma",
    occurredAt: "2026-01-15T22:30:00.000Z",
    status: "open",
  });
  const db = getDb();
  const now = rec.createdAt;
  db.prepare(
    "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("loc-1", rec.id, "Market onu", "kapi zorlanmis", "kapi zorlanmis", "olay-yeri", null, 41.01, 28.97, now);
  const personTranscript = JSON.stringify({
    text: "memur: ne gordun. supheli: beyaz araci gordum, plakayi aldim.",
    segments: [
      { speaker: "memur", text: "ne gordun", start: 0, end: 2 },
      { speaker: "supheli", text: "beyaz araci gordum", start: 2, end: 5 },
      { speaker: "supheli", text: "plakayi aldim", start: 5, end: 7 },
    ],
  });
  db.prepare(
    "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, transcript, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run("per-1", rec.id, "Ahmet Yilmaz", 34, "erkek", "market calisani", "supheli", null, null, 0, "ulasildi", personTranscript, now);
  db.prepare(
    "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, transcript, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run("per-2", rec.id, "Ayse Demir", 28, "kadın", null, "tanik", null, null, 0, null, null, now);
  const evTranscript = JSON.stringify({
    text: "kamera kaydi sesi: motor sesi duyuldu",
    segments: [{ speaker: "kayit", text: "motor sesi duyuldu", start: 0, end: 3 }],
  });
  const marking = JSON.stringify({
    boxes: [
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: "bicak" },
      { x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "beyaz arac" },
      { x: 0.6, y: 0.6, w: 0.1, h: 0.1, label: "bicak" },
    ],
  });
  db.prepare(
    "INSERT INTO evidences (id, caseId, type, title, note, transcript, marking, createdAt) VALUES (?,?,?,?,?,?,?,?)",
  ).run("ev-1", rec.id, "evidence", "Olay yeri bicagi", "mutfak tezgahi", evTranscript, marking, now);
  return rec;
}

function dossierRow(caseId: string) {
  return getDb()
    .prepare("SELECT * FROM case_dossiers WHERE caseId = ?")
    .get(caseId) as { caseId: string; version: number; hash: string; json: string; updatedAt: string };
}

describe("buildDossier", () => {
  it("bilinen vakadan beklenen bolumleri kaynak id'leriyle derler ve DB'ye yazar", async () => {
    const rec = seedFullCase();
    fakeGlimmer.summarize.mockClear();
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);

    expect(d.caseId).toBe(rec.id);
    expect(d.caseNo).toBe(rec.caseNo);
    expect(d.status).toBe("open");
    expect(d.version).toBeGreaterThanOrEqual(1);
    expect(d.hash).toBeTruthy();
    expect(d.event).toMatchObject({
      sourceId: rec.id,
      summary: "Gece market onunde bicakli saldiri",
      crimeType: "yaralama",
      weapon: "bicak",
      mo: "gece yaklasma",
      occurredAt: "2026-01-15T22:30:00.000Z",
    });
    expect(d.locations).toEqual([
      expect.objectContaining({
        sourceId: "loc-1",
        title: "Market onu",
        kind: "olay-yeri",
        latitude: 41.01,
        longitude: 28.97,
      }),
    ]);
    expect(d.persons).toHaveLength(2);
    const suspect = d.persons.find((p) => p.sourceId === "per-1")!;
    expect(suspect).toMatchObject({
      name: "Ahmet Yilmaz",
      type: "supheli",
      age: 34,
      gender: "erkek",
      unidentified: false,
    });
    // Transkript one cikanlari: kaynak id'li ve kaynak metinden birebir alinti
    expect(suspect.transcriptHighlights.length).toBeGreaterThan(0);
    const sourceSegments = ["ne gordun", "beyaz araci gordum", "plakayi aldim"];
    for (const h of suspect.transcriptHighlights) {
      expect(h.sourceId).toBe("per-1");
      expect(sourceSegments).toContain(h.text);
    }
    expect(suspect.transcriptHighlights.map((h) => h.text)).toContain("beyaz araci gordum");
    expect(suspect.transcriptSummary).toBe("Supheli beyaz aracla kactigini anlatti.");
    const witness = d.persons.find((p) => p.sourceId === "per-2")!;
    expect(witness.transcriptHighlights).toEqual([]);
    expect(witness.transcriptSummary ?? null).toBeNull();

    expect(d.evidences).toHaveLength(1);
    expect(d.evidences[0]).toMatchObject({
      sourceId: "ev-1",
      title: "Olay yeri bicagi",
      note: "mutfak tezgahi",
    });
    expect(d.evidences[0].samLabels).toEqual(["bicak", "beyaz arac"]);
    expect(d.evidences[0].transcriptHighlights.map((h) => h.text)).toContain("motor sesi duyuldu");
    expect(d.evidences[0].transcriptHighlights[0].sourceId).toBe("ev-1");

    const row = dossierRow(rec.id);
    expect(row.hash).toBe(d.hash);
    expect(row.version).toBe(d.version);
    expect(JSON.parse(row.json)).toEqual(d);
  });

  it("icerik ayniysa hash ayni kalir ve satir yeniden yazilmaz; degisince hash degisir", async () => {
    const rec = seedFullCase();
    const first = await buildDossier(getDb(), rec.id, fakeGlimmer);
    getDb().prepare("UPDATE case_dossiers SET updatedAt = '2000-01-01T00:00:00.000Z' WHERE caseId = ?").run(rec.id);

    const second = await buildDossier(getDb(), rec.id, fakeGlimmer);
    expect(second.hash).toBe(first.hash);
    expect(dossierRow(rec.id).updatedAt).toBe("2000-01-01T00:00:00.000Z");

    getDb().prepare("UPDATE cases SET summary = 'Degisen ozet metni' WHERE id = ?").run(rec.id);
    const third = await buildDossier(getDb(), rec.id, fakeGlimmer);
    expect(third.hash).not.toBe(first.hash);
    expect(dossierRow(rec.id).hash).toBe(third.hash);
    expect(JSON.parse(dossierRow(rec.id).json).event.summary).toBe("Degisen ozet metni");
  });

  it("kisi/konum/delil yoklugu ve bozuk zenginlestirme JSON'u dosyayi bozmaz", async () => {
    const rec = insertCase({ summary: "sade vaka" });
    const db = getDb();
    db.prepare(
      "INSERT INTO case_persons (id, caseId, name, type, unidentified, transcript, createdAt) VALUES (?,?,?,?,?,?,?)",
    ).run("per-x", rec.id, "Bozuk Kayit", "tanik", 0, "{bozuk json", rec.createdAt);
    const summarize = vi.fn(async () => "cagrilmamali");
    const d = await buildDossier(db, rec.id, { summarize });
    expect(d.locations).toEqual([]);
    expect(d.evidences).toEqual([]);
    expect(d.persons).toHaveLength(1);
    expect(d.persons[0].transcriptHighlights).toEqual([]);
    expect(summarize).not.toHaveBeenCalled();
    expect(dossierRow(rec.id).hash).toBe(d.hash);
  });

  it("Glimmer hatasinda dosya yine derlenir; ozet bos, one cikanlar deterministik kalir", async () => {
    const rec = seedFullCase();
    const failing = {
      summarize: async () => {
        throw new Error("glimmer coktu");
      },
    };
    const d = await buildDossier(getDb(), rec.id, failing);
    const suspect = d.persons.find((p) => p.sourceId === "per-1")!;
    expect(suspect.transcriptSummary ?? null).toBeNull();
    expect(suspect.transcriptHighlights.map((h) => h.text)).toContain("beyaz araci gordum");
  });

  it("istemci verilmezse de (anahtarsiz) dosya derlenir, ag cagrisi basarisizligi dosyayi bozmaz", async () => {
    const rec = seedFullCase();
    const d = await buildDossier(getDb(), rec.id);
    expect(d.persons.find((p) => p.sourceId === "per-1")!.transcriptHighlights.length).toBeGreaterThan(0);
  });

  it("olmayan vaka icin hata firlatir", async () => {
    await expect(buildDossier(getDb(), "yok-boyle-id", fakeGlimmer)).rejects.toThrow();
  });
});

describe("dossierText", () => {
  it("Spark paketine giden duz metin tum bolumleri ve kaynak id'lerini tasir", async () => {
    const rec = seedFullCase();
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);
    const text = dossierText(d);
    expect(text).toContain(rec.caseNo);
    expect(text).toContain("Gece market onunde bicakli saldiri");
    expect(text).toContain("Market onu");
    expect(text).toContain("Ahmet Yilmaz");
    expect(text).toContain("beyaz araci gordum");
    expect(text).toContain("Supheli beyaz aracla kactigini anlatti.");
    expect(text).toContain("bicak");
    expect(text).toContain("motor sesi duyuldu");
    expect(text).toContain("per-1");
    expect(text).toContain("loc-1");
    expect(text).toContain("ev-1");
  });

  it("bos bolumlu dosyada da metin uretir", async () => {
    const rec = insertCase({ summary: "sadece ozet" });
    const d = await buildDossier(getDb(), rec.id, fakeGlimmer);
    const text = dossierText(d);
    expect(text).toContain(rec.caseNo);
    expect(text).toContain("sadece ozet");
  });
});
