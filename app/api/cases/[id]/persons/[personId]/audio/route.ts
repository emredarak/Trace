import { NextResponse } from "next/server";
import { getDb, initDb } from "../../../../../../../lib/db";
import { toPersonResponse } from "../../../../../../../lib/persons";
import { deleteUpload, saveUpload } from "../../../../../../../lib/uploads";

type Params = { params: Promise<{ id: string; personId: string }> };

function findRow(id: string, personId: string) {
  return getDb()
    .prepare("SELECT * FROM case_persons WHERE id = ? AND caseId = ?")
    .get(personId, id) as Record<string, unknown> | undefined;
}

export async function POST(req: Request, { params }: Params) {
  initDb();
  const { id, personId } = await params;
  const existing = findRow(id, personId);
  if (!existing) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  if (existing.type === "maktul") {
    return NextResponse.json(
      { error: "sorgu sesi yalnızca tanık ya da şüpheli için yüklenebilir" },
      { status: 400 },
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "ses dosyası gerekli (form-data 'file')" },
      { status: 400 },
    );
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "ses dosyası gerekli (form-data 'file')" },
      { status: 400 },
    );
  }
  if (file.type && !file.type.startsWith("audio/")) {
    return NextResponse.json(
      { error: "dosya ses dosyası olmalıdır" },
      { status: 400 },
    );
  }
  const old = toPersonResponse(existing).audioFile;
  const stored = await saveUpload(file, id);
  getDb()
    .prepare("UPDATE case_persons SET audioFile = ? WHERE id = ? AND caseId = ?")
    .run(stored, personId, id);
  if (old && old !== stored) deleteUpload(old);
  const updated = findRow(id, personId);
  return NextResponse.json(updated ? toPersonResponse(updated) : null);
}

export async function DELETE(_req: Request, { params }: Params) {
  initDb();
  const { id, personId } = await params;
  const existing = findRow(id, personId);
  if (!existing) {
    return NextResponse.json({ error: "person not found" }, { status: 404 });
  }
  const old = toPersonResponse(existing).audioFile;
  getDb()
    .prepare("UPDATE case_persons SET audioFile = NULL WHERE id = ? AND caseId = ?")
    .run(personId, id);
  deleteUpload(old);
  const updated = findRow(id, personId);
  return NextResponse.json(updated ? toPersonResponse(updated) : null);
}
