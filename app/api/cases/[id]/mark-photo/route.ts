import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import {
  markPhoto,
  type Marking,
} from "../../../../../lib/mark-photo";
import type { Evidence } from "../../../../../lib/case-schema";

function uploadDir(): string {
  return process.env.TRACE_UPLOAD_DIR ?? "uploads";
}

function storedFilename(original: string, caseId: string): string {
  const base = original.split(/[\\/]/).pop() || "photo";
  const dot = base.lastIndexOf(".");
  const ext = (
    dot >= 0 ? base.slice(dot) : ""
  ).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 8);
  return `${caseId}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "photo required (form-data 'file')" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "photo required (form-data 'file')" },
      { status: 400 },
    );
  }
  const hintRaw = form.get("hint");
  const hint = typeof hintRaw === "string" ? hintRaw.trim() : "";
  if (hint.length === 0) {
    return NextResponse.json(
      { error: "hint required (form-data 'hint')" },
      { status: 400 },
    );
  }

  // Persist the uploaded photo to disk first; the file stays even if marking fails.
  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  const stored = storedFilename(file.name, id);
  writeFileSync(join(dir, stored), buffer);

  let marking: Marking;
  try {
    marking = await markPhoto(buffer, hint);
  } catch {
    return NextResponse.json(
      { error: "photo annotation failed, uploaded file was kept" },
      { status: 502 },
    );
  }

  const entry: Evidence = {
    id: randomUUID(),
    caseId: id,
    type: "photo-marking",
    note: JSON.stringify({ hint, boxes: marking.boxes }),
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO evidences (id, caseId, type, note, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(entry.id, entry.caseId, entry.type, entry.note ?? null, entry.createdAt);
  db.prepare("UPDATE cases SET needsRerank = 1 WHERE id = ?").run(id);
  return NextResponse.json(
    { entry, boxes: marking.boxes, file: stored },
    { status: 201 },
  );
}
