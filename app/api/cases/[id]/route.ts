import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../lib/db";
import {
  toLocationResponse,
  type CaseRecord,
  type Evidence,
} from "../../../../lib/case-schema";
import type {
  LocationKind,
  LocationPriority,
} from "../../../../lib/locations";

type Params = { params: Promise<{ id: string }> };

export interface CaseLocation {
  id: string;
  caseId: string;
  title: string;
  note?: string | null;
  locationText?: string | null;
  kind: LocationKind;
  priority: LocationPriority | null;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

// Vaka düzenleme ekranından değiştirilebilen alanlar.
const EDITABLE_FIELDS = [
  "summary",
  "crimeType",
  "locationType",
  "locationText",
  "latitude",
  "longitude",
  "occurredAt",
  "officer",
  "victimAge",
  "victimGender",
  "suspects",
  "witnesses",
  "mo",
  "weapon",
  "status",
] as const;

function findCase(db: ReturnType<typeof getDb>, id: string) {
  return db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
}

export async function GET(_req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const row = findCase(db, id);
  if (!row) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const entries = db
    .prepare("SELECT * FROM evidences WHERE caseId = ? ORDER BY createdAt ASC")
    .all(id) as Evidence[];
  const locations = (
    db
      .prepare(
        "SELECT * FROM case_locations WHERE caseId = ? ORDER BY createdAt ASC",
      )
      .all(id) as Record<string, unknown>[]
  ).map(toLocationResponse) as CaseLocation[];
  return NextResponse.json({
    ...(row as unknown as CaseRecord),
    entries,
    locations,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  const db = getDb();
  if (!findCase(db, id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const updates: Record<string, string | number | null> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (field === "status") {
      if (value !== "open" && value !== "closed") {
        return NextResponse.json(
          { error: "status must be 'open' or 'closed'" },
          { status: 400 },
        );
      }
      updates.status = value;
      continue;
    }
    if (field === "summary") {
      if (typeof value !== "string" || value.trim().length === 0) {
        return NextResponse.json(
          { error: "summary must be a non-empty string" },
          { status: 400 },
        );
      }
      updates.summary = value.trim();
      continue;
    }
    if (field === "victimAge" || field === "latitude" || field === "longitude") {
      if (value === null || value === undefined || value === "") {
        updates[field] = null;
        continue;
      }
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) {
        return NextResponse.json(
          { error: `${field} must be a number` },
          { status: 400 },
        );
      }
      if (
        field === "victimAge" &&
        (!Number.isInteger(num) || num < 0 || num > 120)
      ) {
        return NextResponse.json(
          { error: "victimAge must be an integer between 0 and 120" },
          { status: 400 },
        );
      }
      updates[field] = num;
      continue;
    }
    if (value === null || value === undefined || value === "") {
      updates[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      return NextResponse.json(
        { error: `${field} must be a string` },
        { status: 400 },
      );
    }
    updates[field] = value;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const setClause = Object.keys(updates)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(
    `UPDATE cases SET ${setClause}, needsRerank = 1, updatedAt = @updatedAt WHERE id = @id`,
  ).run({ ...updates, updatedAt: new Date().toISOString(), id });
  const row = findCase(db, id);
  return NextResponse.json(row);
}
