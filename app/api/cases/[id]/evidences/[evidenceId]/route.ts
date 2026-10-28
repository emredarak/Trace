import { NextResponse } from "next/server";
import { enqueueJob, getDb, initDb } from "../../../../../../lib/db";
import {
  normalizeEvidenceInput,
  toEvidenceResponse,
} from "../../../../../../lib/evidences";
import { deleteUpload, saveUpload } from "../../../../../../lib/uploads";

type Params = { params: Promise<{ id: string; evidenceId: string }> };

function findRow(id: string, evidenceId: string) {
  return getDb()
    .prepare("SELECT * FROM evidences WHERE id = ? AND caseId = ?")
    .get(evidenceId, id) as Record<string, unknown> | undefined;
}

export async function PATCH(req: Request, { params }: Params) {
  initDb();
  const { id, evidenceId } = await params;
  const existing = findRow(id, evidenceId);
  if (!existing) {
    return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "form-data gerekli" }, { status: 400 });
  }
  const current = toEvidenceResponse(existing);
  const image = form.get("image");
  const audio = form.get("audio");
  const hasNewImage = image instanceof File && image.size > 0;
  const hasNewAudio = audio instanceof File && audio.size > 0;
  const removeImage = form.get("removeImage") === "1";
  const removeAudio = form.get("removeAudio") === "1";
  const nextImageFile = hasNewImage
    ? undefined
    : removeImage
      ? null
      : current.imageFile;
  const nextAudioFile = hasNewAudio
    ? undefined
    : removeAudio
      ? null
      : current.audioFile;
  let normalized;
  try {
    normalized = normalizeEvidenceInput({
      title: form.get("title"),
      note: form.get("note"),
      hasImage: hasNewImage || nextImageFile != null,
      hasAudio: hasNewAudio || nextAudioFile != null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid evidence" },
      { status: 400 },
    );
  }
  const saved: string[] = [];
  try {
    const imageFile = hasNewImage
      ? await saveUpload(image as File, id)
      : nextImageFile;
    if (hasNewImage && imageFile) saved.push(imageFile);
    const audioFile = hasNewAudio
      ? await saveUpload(audio as File, id)
      : nextAudioFile;
    if (hasNewAudio && audioFile) saved.push(audioFile);
    getDb()
      .prepare(
        `UPDATE evidences SET title = ?, note = ?, imageFile = ?, audioFile = ?,
           marking = CASE WHEN ? THEN NULL ELSE marking END,
           transcript = CASE WHEN ? THEN NULL ELSE transcript END
         WHERE id = ? AND caseId = ?`,
      )
      .run(
        normalized.title,
        normalized.note,
        imageFile ?? null,
        audioFile ?? null,
        hasNewImage || removeImage ? 1 : 0,
        hasNewAudio || removeAudio ? 1 : 0,
        evidenceId,
        id,
      );
  } catch {
    for (const name of saved) deleteUpload(name);
    return NextResponse.json(
      { error: "delil güncellenemedi" },
      { status: 500 },
    );
  }
  // After commit, outside the cleanup catch: enqueue failures or old-file
  // cleanup must never delete files the committed row now references.
  if (hasNewImage) enqueueJob(getDb(), { caseId: id, kind: "sam", refId: evidenceId });
  if (hasNewAudio) enqueueJob(getDb(), { caseId: id, kind: "transcribe", refId: evidenceId });
  if ((hasNewImage || removeImage) && current.imageFile) {
    deleteUpload(current.imageFile);
  }
  if ((hasNewAudio || removeAudio) && current.audioFile) {
    deleteUpload(current.audioFile);
  }
  getDb().prepare("UPDATE cases SET needsRerank = 1 WHERE id = ?").run(id);
  const updated = findRow(id, evidenceId);
  return NextResponse.json(updated ? toEvidenceResponse(updated) : null);
}

export async function DELETE(_req: Request, { params }: Params) {
  initDb();
  const { id, evidenceId } = await params;
  const existing = findRow(id, evidenceId);
  if (!existing) {
    return NextResponse.json({ error: "evidence not found" }, { status: 404 });
  }
  const current = toEvidenceResponse(existing);
  getDb()
    .prepare("DELETE FROM evidences WHERE id = ? AND caseId = ?")
    .run(evidenceId, id);
  deleteUpload(current.imageFile);
  deleteUpload(current.audioFile);
  return NextResponse.json({ deleted: true });
}
