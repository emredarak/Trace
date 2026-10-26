import { NextResponse } from "next/server";
import { getDb, initDb, insertCase } from "../../../lib/db";
import type { CaseRecord, Evidence } from "../../../lib/case-schema";

interface CaseRow {
  id: string;
  caseNo: string;
  needsRerank: number;
  [key: string]: unknown;
}

function toRecord(row: CaseRow, entries: Evidence[]): CaseRecord & { entries: Evidence[] } {
  const { needsRerank, ...rest } = row;
  return {
    ...(rest as unknown as CaseRecord),
    needsRerank: Boolean(needsRerank),
    entries,
  };
}

export async function POST(req: Request) {
  initDb();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const record = insertCase(body as Parameters<typeof insertCase>[0]);
    return NextResponse.json(
      { id: record.id, caseNo: record.caseNo },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}

export async function GET() {
  initDb();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM cases ORDER BY createdAt ASC")
    .all() as CaseRow[];
  const evidences = db
    .prepare("SELECT * FROM evidences ORDER BY createdAt ASC")
    .all() as Evidence[];
  const byCase = new Map<string, Evidence[]>();
  for (const ev of evidences) {
    const list = byCase.get(ev.caseId) ?? [];
    list.push(ev);
    byCase.set(ev.caseId, list);
  }
  return NextResponse.json(
    rows.map((row) => toRecord(row, byCase.get(row.id) ?? [])),
  );
}
