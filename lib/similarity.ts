// Spark Open similarity scoring — all candidates in a single call, itemized
// similarities, source-verified evidence, and hash-pinned persistent results.
//
// Flow:
// 1. Query + candidate dossiers (case_dossiers) are read; when missing they are
//    built with buildDossier (Task 4). Dossier texts enter the package via dossierText.
// 2. Candidates whose queryHash+candidateHash match the current dossiers in
//    similar_results come from the cache; Spark is not called again for them.
// 3. Remaining candidates are scored with a SINGLE Spark call. The package also gets
//    up to 3 deterministically chosen images from evidence sharing a common SAM
//    label (read via lib/uploads; a file missing from disk is skipped, never an error).
// 4. Output is validated: unknown/duplicate caseIds are dropped, score and strength
//    are clamped to 1-10, items whose kind is not in the fixed vocabulary are dropped,
//    items whose evidence quote is not verifiable in the source-only text (deterministic
//    fields + verbatim transcript highlights + SAM labels; Glimmer summaries excluded)
//    are dropped. The Spark package text may include summaries.
// 5. Scored results are written to similar_results with hashes.
// On model/key errors, malformed JSON, or timeouts (SPARK_TIMEOUT_MS,
// default 120000 ms) candidates return unscored — the existing fallback behavior;
// unscored results are NOT written to the cache (retried once a key arrives).
// The legacy lib/rerank.ts path is kept as-is; this module never calls it.

import type Database from "better-sqlite3";
import { sparkChat } from "./spark-client";
import type { SparkImage } from "./spark-client";
import {
  buildDossier,
  dossierSourceText,
  dossierText,
  getDossier,
} from "./dossier";
import type { CaseDossier } from "./dossier";
import type { CandidateMatch } from "./candidates";
import { normalizeTextEnglish } from "./candidates";
import { haversineMeters, formatDistance } from "./locations";
import { contentTypeFor, readUpload } from "./uploads";

export const SIMILARITY_KINDS = [
  "summary",
  "crime-type",
  "method",
  "weapon",
  "location",
  "person",
  "interview-quote",
  "evidence-object",
  "evidence-note",
  "time",
] as const;

export type SimilarityKind = (typeof SIMILARITY_KINDS)[number];

export interface SimilarityItem {
  kind: SimilarityKind;
  description: string;
  strength: number;
  evidence: string;
}

export interface ScoredCase {
  caseId: string;
  caseNo: string;
  score: number;
  reason: string;
  similarities: SimilarityItem[];
}

/** Attached image cap (per case-pair package). */
export const MAX_EVIDENCE_IMAGES = 3;

function parseTimeoutEnv(): number {
  const n = Number(process.env.SPARK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** Long timeout budget: SPARK_TIMEOUT_MS env, default 120000 ms. */
export const SPARK_TIMEOUT_MS = parseTimeoutEnv();

function sparkTimeoutMs(): number {
  return parseTimeoutEnv();
}

// Injectable client seam: tests pass a fake, production uses Spark.
// Accepted shapes: (prompt, images?) => Promise<string>,
// { chatCompletion(prompt, images?) }, { sparkChat(prompt, images?) }.
export type SparkFn = (
  prompt: string,
  images?: SparkImage[],
) => Promise<string>;

export type SparkClientInput =
  | SparkFn
  | { chatCompletion: (prompt: string, images?: SparkImage[]) => Promise<string> }
  | { sparkChat: (prompt: string, images?: SparkImage[]) => Promise<string> };

export type ScoreProgressEvent =
  | { type: "cache_checked"; cachedCount: number; pendingCount: number }
  | { type: "spark_started"; pendingCount: number; imageCount: number }
  | { type: "spark_returned" }
  | { type: "validation_started"; pendingCount: number }
  | {
      type: "scoring_finished";
      scoredCount: number;
      unscoredCount: number;
      sparkCalled: boolean;
      degraded: boolean;
    };

const defaultSpark: SparkFn = (prompt, images) => sparkChat(prompt, images);

function asSparkFn(input: SparkClientInput | undefined): SparkFn {
  if (input === undefined) return defaultSpark;
  if (typeof input === "function") return input;
  const obj = input as {
    chatCompletion?: unknown;
    sparkChat?: unknown;
  };
  if (typeof obj.chatCompletion === "function") {
    const fn = obj.chatCompletion as SparkFn;
    return (p, i) => fn(p, i);
  }
  if (typeof obj.sparkChat === "function") {
    const fn = obj.sparkChat as SparkFn;
    return (p, i) => fn(p, i);
  }
  return defaultSpark;
}

/** Model that actually decides similarity under the current env. */
export function sparkModelName(): string {
  if (process.env.BASETEN_API_KEY) {
    return process.env.SPARK_MODEL ?? "muse-spark-open";
  }
  return (
    process.env.JUDGE_MODEL ??
    process.env.META_MODEL ??
    "Llama-4-Maverick-17B-128E-Instruct-FP8"
  );
}

function clamp1to10(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(10, Math.max(1, value)));
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

function parseModelPayload(raw: string): unknown[] {
  const text = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("model response is not JSON");
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as { results?: unknown; cases?: unknown };
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.cases)) return obj.cases;
  }
  throw new Error("model response is not an array");
}

function normalizeQuote(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”«]+|["'“”»]+$/g, "")
    .trim();
}

/** Evidence must appear verbatim (normalized) in the query or candidate dossier text. */
function evidenceVerified(evidence: string, ...sources: string[]): boolean {
  const needle = normalizeQuote(evidence);
  if (!needle) return false;
  return sources.some((s) => normalizeQuote(s).includes(needle));
}

const KIND_SET = new Set<string>(SIMILARITY_KINDS);

function validateSimilarities(
  raw: unknown,
  queryText: string,
  candidateText: string,
): SimilarityItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SimilarityItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as {
      kind?: unknown;
      description?: unknown;
      strength?: unknown;
      evidence?: unknown;
    };
    if (typeof item.kind !== "string" || !KIND_SET.has(item.kind)) continue;
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const evidence =
      typeof item.evidence === "string" ? item.evidence.trim() : "";
    if (!description || !evidence) continue;
    const strength = clamp1to10(item.strength);
    if (strength === null) continue;
    if (!evidenceVerified(evidence, candidateText, queryText)) continue;
    out.push({
      kind: item.kind as SimilarityKind,
      description,
      strength,
      evidence,
    });
  }
  return out;
}

async function loadDossier(
  db: Database.Database,
  caseId: string,
): Promise<CaseDossier | null> {
  const stored = getDossier(db, caseId);
  if (stored) return stored;
  try {
    return await buildDossier(db, caseId);
  } catch {
    return null;
  }
}

function caseNoOf(db: Database.Database, dossier: CaseDossier | null, caseId: string): string {
  if (dossier?.caseNo) return dossier.caseNo;
  try {
    const row = db
      .prepare("SELECT caseNo FROM cases WHERE id = ?")
      .get(caseId) as { caseNo?: unknown } | undefined;
    if (row && typeof row.caseNo === "string") return row.caseNo;
  } catch {
    // return empty when the table is unreachable
  }
  return "";
}

/** Source-only verification corpus: deterministic fields + verbatim
 * highlights + SAM labels; Glimmer summary text is excluded. */
function sourceText(db: Database.Database, dossier: CaseDossier | null, caseId: string): string {
  if (dossier) return dossierSourceText(dossier);
  return fallbackText(db, null, caseId);
}

function fallbackText(db: Database.Database, dossier: CaseDossier | null, caseId: string): string {
  if (dossier) return dossierText(dossier);
  try {
    const row = db
      .prepare("SELECT caseNo, summary, crimeType, weapon, mo FROM cases WHERE id = ?")
      .get(caseId) as Record<string, unknown> | undefined;
    if (row) {
      return [
        `Case ${String(row.caseNo ?? "")} (id: ${caseId})`,
        `summary: ${String(row.summary ?? "")}`,
        row.crimeType ? `crime type: ${String(row.crimeType)}` : "",
        row.weapon ? `weapon: ${String(row.weapon)}` : "",
        row.mo ? `method: ${String(row.mo)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
  } catch {
    // ignore
  }
  return `Case (id: ${caseId})`;
}

interface CachedRow {
  score: unknown;
  similarities: unknown;
  reason: unknown;
  queryHash: unknown;
  candidateHash: unknown;
}

function readCached(
  db: Database.Database,
  queryId: string,
  candidateId: string,
  queryHash: string,
  candidateHash: string,
  caseNo: string,
  querySourceText = "",
  candidateSourceText = "",
): ScoredCase | null {
  if (!queryHash || !candidateHash) return null;
  let row: CachedRow | undefined;
  try {
    row = db
      .prepare(
        "SELECT score, similarities, reason, queryHash, candidateHash FROM similar_results WHERE queryId = ? AND candidateId = ?",
      )
      .get(queryId, candidateId) as CachedRow | undefined;
  } catch {
    return null;
  }
  if (!row) return null;
  if (row.queryHash !== queryHash || row.candidateHash !== candidateHash) {
    return null;
  }
  const score =
    typeof row.score === "number" && Number.isFinite(row.score) ? row.score : 0;
  if (score <= 0) return null;
  let similarities: SimilarityItem[] = [];
  if (typeof row.similarities === "string" && row.similarities) {
    try {
      const parsed = JSON.parse(row.similarities) as unknown;
      if (Array.isArray(parsed)) {
        similarities = parsed.filter(
          (s): s is SimilarityItem =>
            typeof s === "object" &&
            s !== null &&
            typeof (s as SimilarityItem).kind === "string" &&
            KIND_SET.has((s as SimilarityItem).kind) &&
            typeof (s as SimilarityItem).description === "string" &&
            typeof (s as SimilarityItem).evidence === "string" &&
            typeof (s as SimilarityItem).strength === "number" &&
            // Cached entries also pass source-only verification (an expression from a Glimmer
            // summary in the old record still does not count as evidence).
            (!querySourceText && !candidateSourceText
              ? true
              : evidenceVerified(
                  (s as SimilarityItem).evidence,
                  candidateSourceText,
                  querySourceText,
                )),
        );
      }
    } catch {
      return null;
    }
  }
  return {
    caseId: candidateId,
    caseNo,
    score: Math.round(Math.min(10, Math.max(1, score))),
    reason: typeof row.reason === "string" && row.reason ? row.reason : "",
    similarities,
  };
}

function persistResult(
  db: Database.Database,
  queryId: string,
  scored: ScoredCase,
  queryHash: string,
  candidateHash: string,
): void {
  if (!queryHash || !candidateHash) return;
  try {
    db.prepare(
      `INSERT INTO similar_results (queryId, candidateId, score, similarities, reason, queryHash, candidateHash, model, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(queryId, candidateId) DO UPDATE SET
         score = excluded.score,
         similarities = excluded.similarities,
         reason = excluded.reason,
         queryHash = excluded.queryHash,
         candidateHash = excluded.candidateHash,
         model = excluded.model,
         createdAt = excluded.createdAt`,
    ).run(
      queryId,
      scored.caseId,
      scored.score,
      JSON.stringify(scored.similarities),
      scored.reason,
      queryHash,
      candidateHash,
      sparkModelName(),
      new Date().toISOString(),
    );
  } catch {
    // A failed persistent write still returns the scoring result.
  }
}

function minDistanceMeters(a: CaseDossier, b: CaseDossier): number | null {
  let min = Infinity;
  for (const la of a.locations) {
    if (typeof la.latitude !== "number" || typeof la.longitude !== "number") continue;
    for (const lb of b.locations) {
      if (typeof lb.latitude !== "number" || typeof lb.longitude !== "number") continue;
      const m = haversineMeters(
        { latitude: la.latitude, longitude: la.longitude },
        { latitude: lb.latitude, longitude: lb.longitude },
      );
      if (m < min) min = m;
    }
  }
  return Number.isFinite(min) ? min : null;
}

function sharedSamLabels(a: CaseDossier, b: CaseDossier): string[] {
  const bLabels = new Set<string>();
  for (const ev of b.evidences) {
    for (const label of ev.samLabels) {
      const n = normalizeTextEnglish(label);
      if (n) bLabels.add(n);
    }
  }
  const out: string[] = [];
  for (const ev of a.evidences) {
    for (const label of ev.samLabels) {
      const n = normalizeTextEnglish(label);
      if (n && bLabels.has(n) && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

function sharedPersonNames(a: CaseDossier, b: CaseDossier): string[] {
  const key = (name: string | null, type: string) =>
    name ? `${normalizeTextEnglish(name)}::${normalizeTextEnglish(type ?? "")}` : "";
  const bKeys = new Set<string>();
  for (const p of b.persons) {
    if (p.unidentified) continue;
    const k = key(p.name, p.type);
    if (k) bKeys.add(k);
  }
  const out: string[] = [];
  for (const p of a.persons) {
    if (p.unidentified || !p.name) continue;
    if (bKeys.has(key(p.name, p.type)) && !out.includes(p.name)) out.push(p.name);
  }
  return out;
}

function hintsFor(query: CaseDossier, cand: CaseDossier, channels: string[]): string {
  const parts: string[] = [];
  if (channels.length > 0) parts.push(`candidate channels: ${channels.join(", ")}`);
  const dist = minDistanceMeters(query, cand);
  if (dist !== null) parts.push(`nearest location distance: ${formatDistance(dist)}`);
  const labels = sharedSamLabels(query, cand);
  if (labels.length > 0) parts.push(`shared SAM labels: ${labels.join(", ")}`);
  const persons = sharedPersonNames(query, cand);
  if (persons.length > 0) parts.push(`shared persons: ${persons.join(", ")}`);
  return parts.length > 0 ? `Hints [${cand.caseId}]: ${parts.join(" | ")}` : "";
}

/**
 * deterministically picks up to MAX_EVIDENCE_IMAGES images from evidence
 * sharing a common SAM label. Candidates are visited in input order; for each
 * candidate the candidate evidence is scanned first, then the query evidence.
 * A file missing from disk or not an image is skipped, and nothing ever throws.
 */
export function selectEvidenceImages(
  db: Database.Database,
  query: CaseDossier,
  candidateDossiers: CaseDossier[],
): SparkImage[] {
  const images: SparkImage[] = [];
  const seen = new Set<string>();

  const tryAdd = (caseId: string, evidenceId: string): void => {
    if (images.length >= MAX_EVIDENCE_IMAGES || seen.has(evidenceId)) return;
    seen.add(evidenceId);
    let imageFile: string | null = null;
    try {
      const row = db
        .prepare("SELECT imageFile FROM evidences WHERE id = ?")
        .get(evidenceId) as { imageFile?: unknown } | undefined;
      imageFile =
        row && typeof row.imageFile === "string" && row.imageFile
          ? row.imageFile
          : null;
    } catch {
      return;
    }
    if (!imageFile) return;
    const contentType = contentTypeFor(imageFile);
    if (!contentType.startsWith("image/")) return;
    const buf = readUpload(imageFile);
    if (!buf || buf.length === 0) return;
    images.push({
      caseId,
      evidenceId,
      dataUrl: `data:${contentType};base64,${buf.toString("base64")}`,
    });
  };

  for (const cand of candidateDossiers) {
    if (images.length >= MAX_EVIDENCE_IMAGES) break;
    const queryLabels = new Set<string>();
    for (const ev of query.evidences) {
      for (const label of ev.samLabels) {
        const n = normalizeTextEnglish(label);
        if (n) queryLabels.add(n);
      }
    }
    for (const candEv of cand.evidences) {
      if (images.length >= MAX_EVIDENCE_IMAGES) break;
      const shared = candEv.samLabels.some((l) =>
        queryLabels.has(normalizeTextEnglish(l)),
      );
      if (!shared) continue;
      tryAdd(cand.caseId, candEv.sourceId);
      // Query-side evidence carrying the same label also enters verification.
      const candLabels = new Set(candEv.samLabels.map((l) => normalizeTextEnglish(l)));
      for (const qEv of query.evidences) {
        if (images.length >= MAX_EVIDENCE_IMAGES) break;
        if (qEv.samLabels.some((l) => candLabels.has(normalizeTextEnglish(l)))) {
          tryAdd(query.caseId, qEv.sourceId);
        }
      }
    }
  }
  return images;
}

function buildPrompt(
  queryText: string,
  entries: { dossier: CaseDossier | null; caseId: string; text: string; hints: string }[],
  images: SparkImage[],
): string {
  const lines: string[] = [
    "Compare the following query case against the candidate cases. For each candidate, write each similarity you find as a separate item; rate each item's strength 1-10 based on content, do not use a fixed score table. Rate the overall score 1-10 holistically based on the combined strength of the similarities.",
    `Similarity kinds (kind) may only be one of: ${SIMILARITY_KINDS.join(", ")}.`,
    "Each item's evidence field must be a short verbatim quote from the query or candidate dossier or a SAM label; do not invent quotes not in the source, such an item will be dropped.",
    "If attached images exist, use them for visual verification of the shared SAM-labeled evidence.",
    "",
    "Query case dossier:",
    queryText,
    "",
    "Candidate case dossiers:",
  ];
  for (const e of entries) {
    lines.push("", e.text);
    if (e.hints) lines.push(e.hints);
  }
  if (images.length > 0) {
    lines.push(
      "",
      `Attached images (${images.length}): ${images.map((im, i) => `${i + 1}. case ${im.caseId} evidence ${im.evidenceId}`).join("; ")}`,
    );
  }
  lines.push(
    "",
    "Return only this JSON array, no other text:",
    '[{"caseId": "<candidate id>", "score": <1-10>, "reason": "<short reason>", "similarities": [{"kind": "<type>", "description": "<description>", "strength": <1-10>, "evidence": "<verbatim quote/label from source>"}]}]',
  );
  return lines.join("\n");
}

async function withTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("spark timeout")), timeoutMs);
    });
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function toUnscored(caseId: string, caseNo: string, reason: string): ScoredCase {
  return { caseId, caseNo, score: 0, reason, similarities: [] };
}

interface ModelEntry {
  caseId?: unknown;
  score?: unknown;
  reason?: unknown;
  similarities?: unknown;
}

export async function scoreCandidates(
  db: Database.Database,
  queryId: string,
  candidates: CandidateMatch[],
  spark?: SparkClientInput,
  onProgress?: (event: ScoreProgressEvent) => void,
): Promise<ScoredCase[]> {
  // Deduplicate candidates, preserving input order.
  const seenInput = new Set<string>();
  const ordered: CandidateMatch[] = [];
  for (const c of candidates ?? []) {
    const caseId = typeof c === "string" ? (c as string) : c?.caseId;
    if (typeof caseId !== "string" || !caseId || caseId === queryId) continue;
    if (seenInput.has(caseId)) continue;
    seenInput.add(caseId);
    ordered.push({
      caseId,
      channels: Array.isArray((c as CandidateMatch).channels)
        ? (c as CandidateMatch).channels
        : [],
    });
  }
  if (ordered.length === 0) return [];

  const queryDossier = await loadDossier(db, queryId);
  const queryText = fallbackText(db, queryDossier, queryId);
  const querySourceText = sourceText(db, queryDossier, queryId);
  const queryHash = queryDossier?.hash ?? "";

  const dossiers = new Map<string, CaseDossier | null>();
  const texts = new Map<string, string>();
  const sourceTexts = new Map<string, string>();
  const caseNos = new Map<string, string>();
  for (const c of ordered) {
    const d = await loadDossier(db, c.caseId);
    dossiers.set(c.caseId, d);
    texts.set(c.caseId, fallbackText(db, d, c.caseId));
    sourceTexts.set(c.caseId, sourceText(db, d, c.caseId));
    caseNos.set(c.caseId, caseNoOf(db, d, c.caseId));
  }

  const resultsById = new Map<string, ScoredCase>();
  const pending: CandidateMatch[] = [];
  for (const c of ordered) {
    const d = dossiers.get(c.caseId) ?? null;
    const cached = readCached(
      db,
      queryId,
      c.caseId,
      queryHash,
      d?.hash ?? "",
      caseNos.get(c.caseId) ?? "",
      querySourceText,
      sourceTexts.get(c.caseId) ?? "",
    );
    if (cached) resultsById.set(c.caseId, cached);
    else pending.push(c);
  }
  onProgress?.({
    type: "cache_checked",
    cachedCount: resultsById.size,
    pendingCount: pending.length,
  });

  let degraded = false;
  if (pending.length > 0) {
    const sparkFn = asSparkFn(spark);
    try {
      // Images are selected only for pending (to-be-scored) candidates.
      const pendingDossiers = pending
        .map((c) => dossiers.get(c.caseId) ?? null)
        .filter((d): d is CaseDossier => d !== null);
      const images =
        queryDossier && pendingDossiers.length > 0
          ? selectEvidenceImages(db, queryDossier, pendingDossiers)
          : [];
      const entries = pending.map((c) => {
        const d = dossiers.get(c.caseId) ?? null;
        return {
          dossier: d,
          caseId: c.caseId,
          text: texts.get(c.caseId) ?? "",
          hints:
            queryDossier && d
              ? hintsFor(queryDossier, d, [...c.channels] as string[])
              : c.channels.length > 0
                ? `Hints [${c.caseId}]: candidate channels: ${c.channels.join(", ")}`
                : "",
        };
      });
      const prompt = buildPrompt(queryText, entries, images);
      onProgress?.({
        type: "spark_started",
        pendingCount: pending.length,
        imageCount: images.length,
      });
      const raw = await withTimeout(
        sparkFn(prompt, images.length > 0 ? images : undefined),
        sparkTimeoutMs(),
      );
      onProgress?.({ type: "spark_returned" });
      onProgress?.({ type: "validation_started", pendingCount: pending.length });
      const parsed = parseModelPayload(raw);

      const pendingIds = new Set(pending.map((c) => c.caseId));
      const seen = new Set<string>();
      let validCount = 0;
      for (const entry of parsed as ModelEntry[]) {
        if (typeof entry !== "object" || entry === null) continue;
        const caseId = typeof entry.caseId === "string" ? entry.caseId : "";
        if (!caseId || !pendingIds.has(caseId) || seen.has(caseId)) continue;
        seen.add(caseId);
        validCount += 1;
        const score = clamp1to10(entry.score) ?? 0;
        const scored: ScoredCase = {
          caseId,
          caseNo: caseNos.get(caseId) ?? "",
          score,
          reason:
            typeof entry.reason === "string" && entry.reason.trim()
              ? entry.reason.trim()
              : "model gave no reason",
          similarities: validateSimilarities(
            entry.similarities,
            querySourceText,
            sourceTexts.get(caseId) ?? "",
          ),
        };
        resultsById.set(caseId, scored);
        if (score > 0) {
          const d = dossiers.get(caseId) ?? null;
          persistResult(db, queryId, scored, queryHash, d?.hash ?? "");
        }
      }
      if (validCount === 0) throw new Error("no valid candidate in model response");
      // Candidates skipped by the model are added unscored (no loss).
      for (const c of pending) {
        if (!resultsById.has(c.caseId)) {
          resultsById.set(
            c.caseId,
            toUnscored(c.caseId, caseNos.get(c.caseId) ?? "", "not in model list"),
          );
        }
      }
    } catch {
      degraded = true;
      // Malformed response / key-model error / timeout: unscored fallback.
      for (const c of pending) {
        if (!resultsById.has(c.caseId)) {
          resultsById.set(
            c.caseId,
            toUnscored(
              c.caseId,
              caseNos.get(c.caseId) ?? "",
              "model response unavailable",
            ),
          );
        }
      }
    }
  }

  const inputOrder = new Map(ordered.map((c, i) => [c.caseId, i]));
  const all = ordered
    .map((c) => resultsById.get(c.caseId))
    .filter((s): s is ScoredCase => Boolean(s));
  // Scored first (score descending, input order breaking ties), unscored last.
  all.sort((x, y) => {
    if ((x.score > 0) !== (y.score > 0)) return x.score > 0 ? -1 : 1;
    if (x.score !== y.score) return y.score - x.score;
    return (inputOrder.get(x.caseId) ?? 0) - (inputOrder.get(y.caseId) ?? 0);
  });
  const scoredCount = all.filter((s) => s.score > 0).length;
  onProgress?.({
    type: "scoring_finished",
    scoredCount,
    unscoredCount: all.length - scoredCount,
    sparkCalled: pending.length > 0,
    degraded,
  });
  return all;
}
