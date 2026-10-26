import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import { prefilter } from "../../../../../lib/prefilter";
import { rerankWithTimeout } from "../../../../../lib/rerank";
import type { CaseRecord } from "../../../../../lib/case-schema";

interface CaseRow {
  id: string;
  needsRerank: number;
  [key: string]: unknown;
}

function toRecord(row: CaseRow): CaseRecord {
  const { needsRerank, ...rest } = row;
  return {
    ...(rest as unknown as CaseRecord),
    needsRerank: Boolean(needsRerank),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const queryRow = db
    .prepare("SELECT * FROM cases WHERE id = ?")
    .get(id) as CaseRow | undefined;
  if (!queryRow) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const query = toRecord(queryRow);
  const fresh = !query.needsRerank;

  const candidates = prefilter(db, query).filter((c) => c.caseId !== id);
  if (candidates.length === 0) {
    db.prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(id);
    return NextResponse.json({ results: [], fresh });
  }

  const placeholders = candidates.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM cases WHERE id IN (${placeholders})`)
    .all(...candidates.map((c) => c.caseId)) as CaseRow[];
  const byId = new Map(rows.map((row) => [row.id, toRecord(row)]));
  const records: CaseRecord[] = [];
  for (const c of candidates) {
    const record = byId.get(c.caseId);
    if (record) records.push(record);
  }

  const results = await rerankWithTimeout(records, query);
  db.prepare("UPDATE cases SET needsRerank = 0 WHERE id = ?").run(id);
  return NextResponse.json({ results, fresh });
}
