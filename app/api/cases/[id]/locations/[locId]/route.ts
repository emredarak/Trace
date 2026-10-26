import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../../lib/db";

type Params = { params: Promise<{ id: string; locId: string }> };

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
