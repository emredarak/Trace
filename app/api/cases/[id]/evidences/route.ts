import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { enqueueJob, getDb, initDb } from "../../../../../lib/db";
import {
  normalizeEvidenceInput,
  toEvidenceResponse,
  type CaseEvidence,
} from "../../../../../lib/evidences";
import { deleteUpload, saveUpload } from "../../../../../lib/uploads";

type Params = { params: Promise<{ id: string }> };

function caseExists(id: string): boolean {
  return Boolean(
    getDb().prepare("SELECT id FROM cases WHERE id = ?").get(id) as
      | { id: string }
      | undefined,
  );
}

function findEvidence(evidenceId: string): CaseEvidence | undefined {
  const row = getDb()
    .prepare("SELECT * FROM evidences WHERE id = ?")
    .get(evidenceId) as Record<string, unknown> | undefined;
  return row ? toEvidenceResponse(row) : undefined;
}

export async function GET(_req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  if (!caseExists(id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const rows = getDb()
    .prepare("SELECT * FROM evidences WHERE caseId = ? ORDER BY createdAt ASC")
    .all(id) as Record<string, unknown>[];
  return NextResponse.json(rows.map(toEvidenceResponse));
}

export async function POST(req: Request, { params }: Params) {
  initDb();
  const { id } = await params;
  if (!caseExists(id)) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "form-data gerekli" },
      { status: 400 },
    );
  }
  const clientIdRaw = form.get("id");
  const clientId =
    typeof clientIdRaw === "string" && clientIdRaw.trim()
      ? clientIdRaw.trim()
      : null;
  if (clientId) {
    const existing = findEvidence(clientId);
    if (existing) {
      if (existing.caseId !== id) {
        return NextResponse.json(
          { error: "evidence id belongs to another case" },
          { status: 400 },
        );
      }
      return NextResponse.json(existing, { status: 200 });
    }
  }
  const image = form.get("image");
  const audio = form.get("audio");
  const hasImage = image instanceof File && image.size > 0;
  const hasAudio = audio instanceof File && audio.size > 0;
  let normalized;
  try {
    normalized = normalizeEvidenceInput({
      title: form.get("title"),
      note: form.get("note"),
      hasImage,
      hasAudio,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid evidence" },
      { status: 400 },
    );
  }
  const saved: string[] = [];
  try {
    const imageFile = hasImage ? await saveUpload(image as File, id) : null;
    if (imageFile) saved.push(imageFile);
    const audioFile = hasAudio ? await saveUpload(audio as File, id) : null;
    if (audioFile) saved.push(audioFile);
    const evidenceId = clientId ?? randomUUID();
    getDb()
      .prepare(
        "INSERT INTO evidences (id, caseId, type, title, note, imageFile, audioFile, createdAt) VALUES (?, ?, 'evidence', ?, ?, ?, ?, ?)",
      )
      .run(
        evidenceId,
        id,
        normalized.title,
        normalized.note,
        imageFile,
        audioFile,
        new Date().toISOString(),
      );
    if (imageFile) enqueueJob(getDb(), { caseId: id, kind: "sam", refId: evidenceId });
    if (audioFile) enqueueJob(getDb(), { caseId: id, kind: "transcribe", refId: evidenceId });
    getDb().prepare("UPDATE cases SET needsRerank = 1 WHERE id = ?").run(id);
    return NextResponse.json(findEvidence(evidenceId), { status: 201 });
  } catch {
    for (const name of saved) deleteUpload(name);
    return NextResponse.json(
      { error: "delil kaydedilemedi" },
      { status: 500 },
    );
  }
}
