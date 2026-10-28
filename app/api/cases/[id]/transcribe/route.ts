import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../lib/db";
import {
  transcribe,
  type Transcript,
} from "../../../../../lib/transcribe";
import type { Evidence } from "../../../../../lib/case-schema";

function uploadDir(): string {
  return process.env.TRACE_UPLOAD_DIR ?? "uploads";
}

function storedFilename(original: string, caseId: string): string {
  const base = original.split(/[\\/]/).pop() || "audio";
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
      { error: "audio file required (form-data 'file')" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "audio file required (form-data 'file')" },
      { status: 400 },
    );
  }

  // Persist the uploaded audio to disk first; the file stays even if transcription fails.
  const buffer = Buffer.from(await file.arrayBuffer());
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  const stored = storedFilename(file.name, id);
  writeFileSync(join(dir, stored), buffer);

  let transcript: Transcript;
  try {
    transcript = await transcribe(buffer, file.name || stored);
  } catch {
    return NextResponse.json(
      { error: "audio transcription failed, uploaded file was kept" },
      { status: 502 },
    );
  }

  const entry: Evidence = {
    id: randomUUID(),
    caseId: id,
    type: "transcript",
    note: transcript.text,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO evidences (id, caseId, type, note, createdAt) VALUES (?, ?, ?, ?, ?)",
  ).run(entry.id, entry.caseId, entry.type, entry.note ?? null, entry.createdAt);
  db.prepare("UPDATE cases SET needsRerank = 1 WHERE id = ?").run(id);
  return NextResponse.json({ entry, transcript, file: stored }, { status: 201 });
}
