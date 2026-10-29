import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, enqueueJob, getDb, initDb } from "../lib/db";
import { POST as createCase, GET as listCases } from "../app/api/cases/route";
import { POST as addEntry } from "../app/api/cases/[id]/entries/route";
import { GET as getSimilar } from "../app/api/cases/[id]/similar/route";

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function similarParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function create(body: Record<string, unknown>): Promise<{ id: string; caseNo: string }> {
  const res = await createCase(postRequest("http://localhost/api/cases", body));
  expect(res.status).toBe(201);
  return res.json();
}

const QUERY = {
  summary: "night theft at the waterfront",
  crimeType: "theft",
  locationType: "waterfront",
  weapon: "knife",
  mo: "night approach",
};

async function seedQueryPlusSix(): Promise<string> {
  const query = await create({ ...QUERY });
  for (let n = 1; n <= 6; n++) {
    await create({
      summary: `waterfront night case ${n}`,
      crimeType: "theft",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    });
  }
  return query.id;
}

beforeEach(() => {
  process.env.TRACE_DB_PATH = ":memory:";
  delete process.env.META_API_KEY;
  delete process.env.LLAMA_API_KEY;
  delete process.env.BASETEN_API_KEY;
  delete process.env.SIMILAR_RESULT_LIMIT;
  closeDb();
  initDb();
});

describe("GET /api/cases/[id]/similar", () => {
  it("similarity request returns 5 results", async () => {
    const id = await seedQueryPlusSix();
    const res = await getSimilar(new Request(`http://localhost/api/cases/${id}/similar`), similarParams(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(5);
    expect(body.limit).toBe(5);
    for (const r of body.results) {
      expect(typeof r.caseId).toBe("string");
      expect(r.caseId).not.toBe(id);
      expect(typeof r.caseNo).toBe("string");
      expect(r.caseNo).toMatch(/^TR-\d+$/);
      expect(r.caseNo).not.toBe(r.caseId);
      expect(typeof r.score).toBe("number");
      expect(typeof r.reason).toBe("string");
      expect(Array.isArray(r.similarities)).toBe(true);
      for (const s of r.similarities) {
        expect(typeof s.kind).toBe("string");
        expect(typeof s.description).toBe("string");
        expect(typeof s.strength).toBe("number");
        expect(typeof s.evidence).toBe("string");
      }
    }
    expect(typeof body.fresh).toBe("boolean");
  });

  it("SIMILAR_RESULT_LIMIT caps results and the limit field", async () => {
    const id = await seedQueryPlusSix();
    process.env.SIMILAR_RESULT_LIMIT = "2";
    const res = await getSimilar(new Request(`http://localhost/api/cases/${id}/similar`), similarParams(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(2);
    expect(body.results).toHaveLength(2);
  });

  it("closed cases are in the candidate pool", async () => {
    const query = await create({ ...QUERY });
    const candidate = await create({
      summary: "waterfront night theft closed case",
      crimeType: "theft",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    });
    getDb().prepare("UPDATE cases SET status = 'closed' WHERE id = ?").run(candidate.id);
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.results.find((r: { caseId: string }) => r.caseId === candidate.id);
    expect(found).toBeTruthy();
    expect(found.caseNo).toBe(candidate.caseNo);
  });

  it("a case without a prebuilt dossier becomes a candidate via the text (FTS) channel", async () => {
    const query = await create({ ...QUERY });
    const candidate = await create({
      summary: "waterfront night theft dossierless case",
      crimeType: "theft",
      locationType: "waterfront",
      weapon: "knife",
      mo: "night approach",
    });
    // No dossier was prebuilt for any case.
    const before = getDb().prepare("SELECT COUNT(*) AS n FROM case_dossiers").get() as { n: number };
    expect(before.n).toBe(0);
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { caseId: string }) => r.caseId)).toContain(candidate.id);
  });

  it("pending enrichment jobs run bounded and pendingEnrichment is reported", async () => {
    const query = await create({ ...QUERY });
    const jobId = enqueueJob(getDb(), { caseId: query.id, kind: "transcribe", refId: "missing-record" });
    const res = await getSimilar(new Request(`http://localhost/api/cases/${query.id}/similar`), similarParams(query.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingEnrichment).toBe(true);
    // The job was attempted (failed, retryable) - record/job not lost.
    const job = getDb().prepare("SELECT status, attempts FROM enrichment_jobs WHERE id = ?").get(jobId) as { status: string; attempts: number };
    expect(job.attempts).toBe(1);
    expect(job.status).toBe("failed");
  });

  it("adding new evidence sets needsRerank true, cleared after viewing similarity", async () => {
    const created = await create({ summary: "unbadged case" });

    let list = await (await listCases()).json();
    expect(list.find((c: { id: string }) => c.id === created.id).needsRerank).toBe(true);

    // Reset the flag: count as similarity viewed.
    getDb().prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(created.id);

    const entryRes = await addEntry(
      postRequest(`http://localhost/api/cases/${created.id}/entries`, { type: "note", note: "new evidence" }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(entryRes.status).toBe(201);

    list = await (await listCases()).json();
    expect(list.find((c: { id: string }) => c.id === created.id).needsRerank).toBe(true);

    const stale = await (
      await getSimilar(
        new Request(`http://localhost/api/cases/${created.id}/similar`),
        similarParams(created.id),
      )
    ).json();
    expect(stale.fresh).toBe(false);

    const fresh = await (
      await getSimilar(
        new Request(`http://localhost/api/cases/${created.id}/similar`),
        similarParams(created.id),
      )
    ).json();
    expect(fresh.fresh).toBe(true);
  });

  it("returns [] when there is no similar case, not an error", async () => {
    const created = await create({ summary: "zxqwv kpjbn lone case" });
    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${created.id}/similar`),
      similarParams(created.id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([]);
    expect(typeof body.fresh).toBe("boolean");
  });

  it("returns 404 for a missing record", async () => {
    const res = await getSimilar(
      new Request("http://localhost/api/cases/yok/similar"),
      similarParams("yok"),
    );
    expect(res.status).toBe(404);
  });

  it("streams NDJSON progress ending in the same result as the plain call", async () => {
    const id = await seedQueryPlusSix();
    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${id}/similar?stream=1`),
      similarParams(id),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const text = await res.text();
    const events = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events[0].type).toBe("started");
    expect(events[events.length - 1].type).toBe("result");
    const completedStages = events
      .filter((e) => e.type === "stage_completed")
      .map((e) => e.stage);
    expect(completedStages).toEqual([
      "enrichment",
      "dossiers",
      "candidates",
      "scoring",
      "verification",
    ]);
    for (const e of events.filter((e) => e.type === "stage_completed")) {
      expect(typeof e.durationMs).toBe("number");
      expect(e.durationMs as number).toBeGreaterThanOrEqual(0);
    }
    expect(events.every((e) => typeof e.seq === "number" && typeof e.elapsedMs === "number")).toBe(true);

    const plain = await (
      await getSimilar(new Request(`http://localhost/api/cases/${id}/similar`), similarParams(id))
    ).json();
    const result = events[events.length - 1] as unknown as Record<string, unknown>;
    expect(result.results).toEqual(plain.results);
    // The streamed call ran first and cleared needsRerank, so only it reports stale.
    expect(result.fresh).toBe(false);
    expect(plain.fresh).toBe(true);
    expect(result.limit).toBe(plain.limit);

    // Both the streamed and the plain call recorded a timing run.
    const runs = getDb().prepare("SELECT COUNT(*) AS n FROM similar_search_runs").get() as { n: number };
    expect(runs.n).toBe(2);
  });

  it("marks scoring degraded and verification skipped on the no-key fallback, still returning a result", async () => {
    const id = await seedQueryPlusSix();
    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${id}/similar?stream=1`),
      similarParams(id),
    );
    const events = (await res.text())
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const scoring = events.find((e) => e.type === "stage_completed" && e.stage === "scoring");
    const verification = events.find((e) => e.type === "stage_completed" && e.stage === "verification");
    expect(scoring?.status).toBe("degraded");
    expect(verification?.status).toBe("skipped");
    expect(events[events.length - 1].type).toBe("result");
  });

  it("progress events before the result carry counts only, never case content", async () => {
    const id = await seedQueryPlusSix();
    const res = await getSimilar(
      new Request(`http://localhost/api/cases/${id}/similar?stream=1`),
      similarParams(id),
    );
    const lines = (await res.text()).split("\n").filter((l) => l.trim());
    const progressText = lines.slice(0, -1).join("\n");
    expect(progressText).not.toContain("waterfront");
    expect(progressText).not.toContain("night theft");
    expect(progressText).not.toContain("TR-");
  });

  it("streamed call for a missing case is still a plain 404 JSON", async () => {
    const res = await getSimilar(
      new Request("http://localhost/api/cases/yok/similar?stream=1"),
      similarParams("yok"),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
