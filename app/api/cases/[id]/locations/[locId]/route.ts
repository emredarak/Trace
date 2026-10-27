import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../../lib/db";
import {
  normalizeLocationInput,
  toLocationResponse,
} from "../../../../../../lib/case-schema";

type Params = { params: Promise<{ id: string; locId: string }> };

function findRow(id: string, locId: string) {
  return getDb()
    .prepare("SELECT * FROM case_locations WHERE id = ? AND caseId = ?")
    .get(locId, id) as Record<string, unknown> | undefined;
}

export async function PATCH(req: Request, { params }: Params) {
  initDb();
  const { id, locId } = await params;
  if (!findRow(id, locId)) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let normalized;
  try {
    normalized = normalizeLocationInput(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid location" },
      { status: 400 },
    );
  }
  getDb()
    .prepare(
      "UPDATE case_locations SET title = ?, note = ?, locationText = ?, kind = ?, priority = ?, latitude = ?, longitude = ? WHERE id = ? AND caseId = ?",
    )
    .run(
      normalized.title ?? "Konum",
      normalized.note ?? null,
      normalized.note ?? null,
      normalized.kind ?? "iliskili",
      normalized.priority ?? null,
      normalized.latitude ?? null,
      normalized.longitude ?? null,
      locId,
      id,
    );
  const updated = findRow(id, locId);
  return NextResponse.json(updated ? toLocationResponse(updated) : undefined);
}

export async function DELETE(_req: Request, { params }: Params) {
  initDb();
  const { id, locId } = await params;
  const db = getDb();
  const result = db
    .prepare("DELETE FROM case_locations WHERE id = ? AND caseId = ?")
    .run(locId, id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "location not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
