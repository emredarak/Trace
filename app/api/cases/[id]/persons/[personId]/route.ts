import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../../lib/db";
import {
  normalizePersonInput,
  toPersonResponse,
} from "../../../../../../lib/persons";
import { deleteUpload } from "../../../../../../lib/uploads";

type Params = { params: Promise<{ id: string; personId: string }> };

function findRow(id: string, personId: string) {
  return getDb()
    .prepare("SELECT * FROM case_persons WHERE id = ? AND caseId = ?")
    .get(personId, id) as Record<string, unknown> | undefined;
}

function isRelatedVictim(caseId: string, personId: string): boolean {
  return Boolean(
    getDb()
      .prepare(
        "SELECT id FROM case_persons WHERE id = ? AND caseId = ? AND type = 'victim'",
      )
      .get(personId, caseId),
  );
}

export async function PATCH(req: Request, { params }: Params) {
  initDb();
  const { id, personId } = await params;
  const existing = findRow(id, personId);
  if (!existing) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  let normalized;
  try {
    normalized = normalizePersonInput(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid person" },
      { status: 400 },
    );
  }
  if (
    normalized.relatedVictimId !== null &&
    (normalized.relatedVictimId === personId ||
      !isRelatedVictim(id, normalized.relatedVictimId))
  ) {
    return NextResponse.json(
      {
        error:
          "person.relatedVictimId must reference a victim person in the same case",
      },
      { status: 400 },
    );
  }
  const db = getDb();
  const clearAudio = normalized.type === "victim";
  db.transaction(() => {
    db.prepare(
      `UPDATE case_persons SET name = ?, age = ?, gender = ?, note = ?, type = ?, relatedVictimId = ?, relationship = ?, unidentified = ?, contactStatus = ?${clearAudio ? ", audioFile = NULL" : ""} WHERE id = ? AND caseId = ?`,
    ).run(
      normalized.name,
      normalized.age,
      normalized.gender,
      normalized.note,
      normalized.type,
      normalized.relatedVictimId,
      normalized.relationship,
      normalized.unidentified ? 1 : 0,
      normalized.contactStatus,
      personId,
      id,
    );
    if (existing.type === "victim" && normalized.type !== "victim") {
      db.prepare(
        "UPDATE case_persons SET relatedVictimId = NULL, relationship = NULL WHERE relatedVictimId = ? AND caseId = ?",
      ).run(personId, id);
    }
  })();
  if (clearAudio) deleteUpload(toPersonResponse(existing).audioFile);
  const updated = findRow(id, personId);
  if (!updated) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  return NextResponse.json(toPersonResponse(updated));
}

export async function DELETE(_req: Request, { params }: Params) {
  initDb();
  const { id, personId } = await params;
  const existingRow = findRow(id, personId);
  if (!existingRow) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      "UPDATE case_persons SET relatedVictimId = NULL, relationship = NULL WHERE relatedVictimId = ? AND caseId = ?",
    ).run(personId, id);
    db.prepare(
      "DELETE FROM case_persons WHERE id = ? AND caseId = ?",
    ).run(personId, id);
  })();
  deleteUpload(toPersonResponse(existingRow).audioFile);
  return NextResponse.json({ deleted: true });
}
