import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import { processPendingJobs } from "../../../../../lib/enrichment";
import { buildDossier, type CaseDossier } from "../../../../../lib/dossier";
import { findCandidates } from "../../../../../lib/candidates";
import { scoreCandidates } from "../../../../../lib/similarity";

/** Tek istekte calistirilacak zenginlestirme isi ust siniri. */
const ENRICHMENT_JOB_LIMIT = 5;

function similarResultLimit(): number {
  const n = Number(process.env.SIMILAR_RESULT_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function hasPendingEnrichment(db: ReturnType<typeof getDb>): boolean {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM enrichment_jobs
         WHERE status = 'pending' OR (status = 'failed' AND attempts < 3)`,
      )
      .get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const queryRow = db
    .prepare("SELECT needsRerank FROM cases WHERE id = ?")
    .get(id) as { needsRerank: number } | undefined;
  if (!queryRow) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const fresh = !queryRow.needsRerank;
  const limit = similarResultLimit();

  // Bekleyen zenginlestirme islerini sinirli sayida calistir; hata akisi bozmaz.
  try {
    await processPendingJobs(db, ENRICHMENT_JOB_LIMIT);
  } catch {
    // Zenginlestirme basarisiz olsa da benzerlik kalan veriyle surer.
  }
  const pendingEnrichment = hasPendingEnrichment(db);

  // CARRIED (Task 5): dossiers for ALL cases are built before findCandidates;
  // the query is excluded only from the candidate pool (inside findCandidates),
  // not from dossier building. findCandidates silently drops cases missing
  // from the supplied pool, so a partial pool would be a correctness bug.
  const caseRows = db.prepare("SELECT id FROM cases").all() as { id: string }[];
  const dossiers: CaseDossier[] = [];
  for (const row of caseRows) {
    try {
      dossiers.push(await buildDossier(db, row.id));
    } catch {
      // Tek vakanin dosyasi derlenemezse digerleri yine de aday olabilir.
    }
  }

  const candidates = findCandidates(db, id, dossiers);
  const scored = candidates.length > 0 ? await scoreCandidates(db, id, candidates) : [];
  const results = scored.slice(0, limit);

  db.prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(id);
  return NextResponse.json({ results, fresh, limit, pendingEnrichment });
}
