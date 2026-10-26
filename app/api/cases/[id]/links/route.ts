import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";

type RouteParams = { params: { id: string } | Promise<{ id: string }> };

async function readTargetId(req: Request): Promise<unknown> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("targetId");
  if (fromQuery) return fromQuery;
  try {
    const body = await req.json();
    return body?.targetId;
  } catch {
    return undefined;
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  initDb();
  const { id } = await params;
  const targetId = await readTargetId(req);
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }
  const db = getDb();
  const source = db
    .prepare("SELECT id FROM cases WHERE id = ?")
    .get(id) as { id: string } | undefined;
  if (!source) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const target = db
    .prepare("SELECT id FROM cases WHERE id = ?")
    .get(targetId) as { id: string } | undefined;
  if (!target) {
    return NextResponse.json({ error: "target case not found" }, { status: 404 });
  }
  db.prepare(
    "INSERT OR IGNORE INTO case_links (sourceId, targetId, createdAt) VALUES (?, ?, ?)",
  ).run(id, targetId, new Date().toISOString());
  return NextResponse.json({ sourceId: id, targetId }, { status: 201 });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  initDb();
  const { id } = await params;
  const targetId = await readTargetId(req);
  if (typeof targetId !== "string" || targetId.trim().length === 0) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }
  const db = getDb();
  db.prepare("DELETE FROM case_links WHERE sourceId = ? AND targetId = ?").run(
    id,
    targetId,
  );
  return NextResponse.json({ sourceId: id, targetId });
}
