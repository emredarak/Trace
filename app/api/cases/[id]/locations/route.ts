import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import type { CaseLocation } from "../route";

type Params = { params: Promise<{ id: string }> };

function toNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export async function GET(_req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM cases WHERE id = ?")
    .get(id) as { id: string } | undefined;
  if (!exists) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const rows = db
    .prepare(
      "SELECT * FROM case_locations WHERE caseId = ? ORDER BY createdAt ASC",
    )
    .all(id) as CaseLocation[];
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  const db = getDb();
  const exists = db
    .prepare("SELECT id FROM cases WHERE id = ?")
    .get(id) as { id: string } | undefined;
  if (!exists) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  let body: {
    note?: unknown;
    locationText?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const latitude = toNumber(body?.latitude);
  const longitude = toNumber(body?.longitude);
  if (latitude === undefined || longitude === undefined) {
    return NextResponse.json(
      { error: "latitude/longitude must be numbers" },
      { status: 400 },
    );
  }
  const locationText =
    typeof body?.locationText === "string" && body.locationText.trim()
      ? body.locationText.trim()
      : null;
  const note =
    typeof body?.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;
  if (latitude === null && longitude === null && locationText === null) {
    return NextResponse.json(
      { error: "konum metni ya da koordinat gerekli" },
      { status: 400 },
    );
  }
  const loc: CaseLocation = {
    id: randomUUID(),
    caseId: id,
    note: note ?? undefined,
    locationText: locationText ?? undefined,
    latitude: latitude ?? undefined,
    longitude: longitude ?? undefined,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO case_locations (id, caseId, note, locationText, latitude, longitude, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    loc.id,
    loc.caseId,
    note,
    locationText,
    latitude,
    longitude,
    loc.createdAt,
  );
  return NextResponse.json(loc, { status: 201 });
}
