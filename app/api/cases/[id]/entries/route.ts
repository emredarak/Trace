import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import type { Evidence } from "../../../../../lib/case-schema";

export async function POST(
  req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM cases WHERE id = ?")
    .get(id) as { id: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  let body: { type?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body?.type !== "string" || body.type.trim().length === 0) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const entry: Evidence = {
    id: randomUUID(),
    caseId: id,
    type: body.type,
    note: typeof body.note === "string" ? body.note : undefined,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO evidences (id, caseId, type, note, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(entry.id, entry.caseId, entry.type, entry.note ?? null, entry.createdAt);
  db.prepare("UPDATE cases SET needsRerank = 1 WHERE id = ?").run(id);
  return NextResponse.json(entry, { status: 201 });
}
