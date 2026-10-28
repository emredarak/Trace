import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export function uploadDir(): string {
  return process.env.TRACE_UPLOAD_DIR ?? "uploads";
}

export function storedFilename(original: string, caseId: string): string {
  const base = original.split(/[\\/]/).pop() || "file";
  const dot = base.lastIndexOf(".");
  const ext = (dot >= 0 ? base.slice(dot) : "")
    .replace(/[^.a-zA-Z0-9]/g, "")
    .slice(0, 8);
  return `${caseId}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
}

export async function saveUpload(file: File, caseId: string): Promise<string> {
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  const stored = storedFilename(file.name, caseId);
  writeFileSync(join(dir, stored), Buffer.from(await file.arrayBuffer()));
  return stored;
}

// Yalnızca düz dosya adı kabul edilir; yol ayırıcı içeren adlar reddedilir.
export function safeUploadName(name: string): string | null {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (!decoded || decoded !== basename(decoded)) return null;
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) {
    return null;
  }
  return decoded;
}

export function readUpload(name: string): Buffer | null {
  const safe = safeUploadName(name);
  if (!safe) return null;
  try {
    return readFileSync(join(uploadDir(), safe));
  } catch {
    return null;
  }
}

export function deleteUpload(name: string | null | undefined): void {
  if (!name) return;
  const safe = safeUploadName(name);
  if (!safe) return;
  try {
    unlinkSync(join(uploadDir(), safe));
  } catch {
    // Dosya zaten yoksa sessiz geç.
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
};

export function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
