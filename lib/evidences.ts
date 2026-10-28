export interface CaseEvidence {
  id: string;
  caseId: string;
  type: string;
  title: string;
  note: string | null;
  imageFile: string | null;
  audioFile: string | null;
  createdAt: string;
}

export interface CaseEvidenceDraft {
  id: string;
  title: string;
  note: string;
  type?: string;
  imageFile?: string | null;
  audioFile?: string | null;
  image?: File | null;
  audio?: File | null;
  removeImage?: boolean;
  removeAudio?: boolean;
}

export function evidenceFileUrl(name: string): string {
  return `/api/files/${encodeURIComponent(name)}`;
}

export function evidenceHasContent(draft: {
  note?: string | null;
  imageFile?: string | null;
  audioFile?: string | null;
  image?: File | null;
  audio?: File | null;
  removeImage?: boolean;
  removeAudio?: boolean;
}): boolean {
  if (typeof draft.note === "string" && draft.note.trim().length > 0) return true;
  if (draft.image || (draft.imageFile && !draft.removeImage)) return true;
  if (draft.audio || (draft.audioFile && !draft.removeAudio)) return true;
  return false;
}

export function validateEvidenceDraft(draft: CaseEvidenceDraft): string | null {
  if (!draft.title.trim()) return "Evidence title is required.";
  if (!evidenceHasContent(draft)) {
    return "At least one of image, audio or note is required.";
  }
  return null;
}

export function normalizeEvidenceInput(raw: {
  title?: unknown;
  note?: unknown;
  hasImage?: boolean;
  hasAudio?: boolean;
}): { title: string; note: string | null } {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) throw new Error("evidence.title is required");
  const note =
    typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : null;
  if (!note && !raw.hasImage && !raw.hasAudio) {
    throw new Error("evidence needs at least one of image, audio or note");
  }
  return { title, note };
}

const LEGACY_TITLES: Record<string, string> = {
  transcript: "Statement",
  "photo-marking": "Photo",
  note: "Note",
};

export function toEvidenceResponse(
  row: Record<string, unknown>,
): CaseEvidence {
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const type = typeof row.type === "string" && row.type ? row.type : "evidence";
  const title =
    text(row.title) ??
    (type === "evidence" ? "Evidence" : (LEGACY_TITLES[type] ?? type));
  return {
    id: String(row.id),
    caseId: String(row.caseId),
    type,
    title,
    note: text(row.note),
    imageFile: text(row.imageFile),
    audioFile: text(row.audioFile),
    createdAt: String(row.createdAt),
  };
}
