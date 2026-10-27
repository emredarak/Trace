import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import {
  normalizePersonInput,
  toPersonResponse,
  type CasePerson,
} from "../../../../../lib/persons";

type Params = { params: Promise<{ id: string }> };

function caseExists(id: string): boolean {
  const db = getDb();
  return Boolean(
    db.prepare("SELECT id FROM cases WHERE id = ?").get(id) as
      | { id: string }
      | undefined,
  );
}

function findPerson(id: string): CasePerson | undefined {
  const row = getDb()
    .prepare("SELECT * FROM case_persons WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? toPersonResponse(row) : undefined;
}

function isRelatedVictim(caseId: string, personId: string): boolean {
  return Boolean(
    getDb()
      .prepare(
        "SELECT id FROM case_persons WHERE id = ? AND caseId = ? AND type = 'maktul'",
      )
      .get(personId, caseId),
  );
}

export async function GET(_req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  if (!caseExists(id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const rows = getDb()
    .prepare(
      "SELECT * FROM case_persons WHERE caseId = ? ORDER BY createdAt ASC",
    )
    .all(id) as Record<string, unknown>[];
  return NextResponse.json(rows.map(toPersonResponse));
}

export async function POST(req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  if (!caseExists(id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
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
  let personId: string = randomUUID();
  if (normalized.id !== undefined) {
    personId = normalized.id;
    const existing = getDb()
      .prepare("SELECT * FROM case_persons WHERE id = ?")
      .get(personId) as Record<string, unknown> | undefined;
    if (existing) {
      if (String(existing.caseId) !== id) {
        return NextResponse.json(
          { error: "person id belongs to another case" },
          { status: 400 },
        );
      }
      return NextResponse.json(toPersonResponse(existing), { status: 200 });
    }
  }
  if (
    normalized.relatedVictimId !== null &&
    !isRelatedVictim(id, normalized.relatedVictimId)
  ) {
    return NextResponse.json(
      {
        error:
          "person.relatedVictimId must reference a maktul person in the same case",
      },
      { status: 400 },
    );
  }
  getDb()
    .prepare(
      "INSERT INTO case_persons (id, caseId, name, age, gender, note, type, relatedVictimId, relationship, unidentified, contactStatus, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      personId,
      id,
      normalized.name,
      normalized.age,
      normalized.gender,
      normalized.note,
      normalized.type,
      normalized.relatedVictimId,
      normalized.relationship,
      normalized.unidentified ? 1 : 0,
      normalized.contactStatus,
      new Date().toISOString(),
    );
  return NextResponse.json(findPerson(personId), { status: 201 });
}
