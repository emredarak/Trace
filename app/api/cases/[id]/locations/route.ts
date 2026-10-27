import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import {
  normalizeLocationInput,
  toLocationResponse,
} from "../../../../../lib/case-schema";
import type { CaseLocation } from "../route";

type Params = { params: Promise<{ id: string }> };

function caseExists(id: string): boolean {
  const db = getDb();
  return Boolean(
    db.prepare("SELECT id FROM cases WHERE id = ?").get(id) as
      | { id: string }
      | undefined,
  );
}

function findLocation(id: string): CaseLocation | undefined {
  const row = getDb()
    .prepare("SELECT * FROM case_locations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? toLocationResponse(row) : undefined;
}

export async function GET(_req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  if (!caseExists(id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const rows = getDb()
    .prepare(
      "SELECT * FROM case_locations WHERE caseId = ? ORDER BY createdAt ASC",
    )
    .all(id) as Record<string, unknown>[];
  return NextResponse.json(rows.map(toLocationResponse));
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
    normalized = normalizeLocationInput(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid location" },
      { status: 400 },
    );
  }
  const locId = randomUUID();
  getDb()
    .prepare(
      "INSERT INTO case_locations (id, caseId, title, note, locationText, kind, priority, latitude, longitude, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      locId,
      id,
      normalized.title ?? "Konum",
      normalized.note ?? null,
      normalized.note ?? null,
      normalized.kind ?? "iliskili",
      normalized.priority ?? null,
      normalized.latitude ?? null,
      normalized.longitude ?? null,
      new Date().toISOString(),
    );
  return NextResponse.json(findLocation(locId), { status: 201 });
}
