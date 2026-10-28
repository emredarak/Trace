import type { CaseRecord } from "./case-schema";
import { sparkChat as defaultChatCompletion } from "./spark-client";
import type { CaseFeatures } from "./prefilter";

export interface RankedCase {
  caseId: string;
  /** 0 = unscored, 1-10 = scored. */
  score: number;
  reason: string;
  quote: string;
  matchedFields: string[];
}

// Injectable client seam: tests pass a fake, production uses Spark (spark-client).
export interface ChatClient {
  chatCompletion(prompt: string): Promise<string>;
}

const MAX_RESULTS = 5;
const COMPARE_FIELDS = ["crimeType", "locationType", "weapon", "mo"] as const;

function tokenize(value: string): string[] {
  const tokens = value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return [...new Set(tokens.map((t) => t.toLowerCase()))];
}

function fieldsOverlap(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA.length === 0 || lowerB.length === 0) return false;
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  return (
    tokensA.some((t) => lowerB.includes(t)) ||
    tokensB.some((t) => lowerA.includes(t))
  );
}

export function matchedFieldsFor(
  query: CaseFeatures,
  candidate: CaseFeatures,
): string[] {
  const out: string[] = [];
  for (const field of COMPARE_FIELDS) {
    if (fieldsOverlap(query[field], candidate[field])) out.push(field);
  }
  return out;
}

function describeCase(c: CaseRecord): string {
  const parts = [
    `id: ${c.id}`,
    `summary: ${c.summary}`,
    c.crimeType ? `crime type: ${c.crimeType}` : "",
    c.locationType ? `location type: ${c.locationType}` : "",
    c.weapon ? `weapon: ${c.weapon}` : "",
    c.mo ? `method: ${c.mo}` : "",
  ].filter(Boolean);
  return `- ${parts.join(" | ")}`;
}

function buildPrompt(cases: CaseRecord[], query: CaseRecord): string {
  return [
    "Rank the candidate cases most similar to the query case.",
    "",
    `Query case: ${describeCase(query)}`,
    "",
    "Candidate cases:",
    ...cases.map((c) => describeCase(c)),
    "",
    "Return only this JSON array, no other text:",
    '[{"caseId": "<candidate id>", "score": <1-10 similarity score>, "reason": "<short reason>", "quote": "<short quote from candidate>"}]',
  ].join("\n");
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

interface ModelEntry {
  caseId?: unknown;
  score?: unknown;
  reason?: unknown;
  quote?: unknown;
}

function toUnscored(
  c: CaseRecord,
  query: CaseRecord,
  reason: string,
): RankedCase {
  return {
    caseId: c.id,
    score: 0,
    reason,
    quote: c.summary ?? "",
    matchedFields: matchedFieldsFor(query, c),
  };
}

export async function rerank(
  cases: CaseRecord[],
  query: CaseRecord,
  client: ChatClient = { chatCompletion: defaultChatCompletion },
): Promise<RankedCase[]> {
  if (cases.length === 0) return [];
  const byId = new Map(cases.map((c) => [c.id, c]));

  try {
    const raw = await client.chatCompletion(buildPrompt(cases, query));
    const parsed: unknown = JSON.parse(stripFences(raw));
    if (!Array.isArray(parsed)) throw new Error("model response is not an array");

    const scored: RankedCase[] = [];
    const seen = new Set<string>();
    for (const entry of parsed as ModelEntry[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const candidate =
        typeof entry.caseId === "string" ? byId.get(entry.caseId) : undefined;
      if (!candidate || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const score =
        typeof entry.score === "number" && Number.isFinite(entry.score)
          ? Math.round(Math.min(10, Math.max(1, entry.score)))
          : 0;
      scored.push({
        caseId: candidate.id,
        score,
        reason:
          typeof entry.reason === "string" && entry.reason.trim().length > 0
            ? entry.reason.trim()
            : "model gave no reason",
        quote:
          typeof entry.quote === "string" && entry.quote.trim().length > 0
            ? entry.quote.trim()
            : (candidate.summary ?? ""),
        matchedFields: matchedFieldsFor(query, candidate),
      });
    }
    if (seen.size === 0) throw new Error("no valid candidate in model response");

    scored.sort((x, y) => y.score - x.score);
    // Add candidates skipped by the model unscored (no loss), then take the first 5.
    for (const c of cases) {
      if (!seen.has(c.id)) scored.push(toUnscored(c, query, "not in model list"));
    }
    return scored.slice(0, MAX_RESULTS);
  } catch {
    // Malformed response / client error: list the first 5 candidates unscored, in input order.
    return cases
      .map((c) => toUnscored(c, query, "model response unavailable"))
      .slice(0, MAX_RESULTS);
  }
}

export const RERANK_TIMEOUT_MS = 15_000;

// Never leaves the request hanging on a slow/unresponsive model client: times out after 15s
// and falls back to the existing fallback path (unscored list, no loss).
export async function rerankWithTimeout(
  cases: CaseRecord[],
  query: CaseRecord,
  client?: ChatClient,
  timeoutMs: number = RERANK_TIMEOUT_MS,
): Promise<RankedCase[]> {
  if (cases.length === 0) return [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("rerank timeout")),
        timeoutMs,
      );
    });
    const pending =
      client === undefined
        ? rerank(cases, query)
        : rerank(cases, query, client);
    return await Promise.race([pending, timeout]);
  } catch {
    return cases
      .map((c) => toUnscored(c, query, "model response unavailable"))
      .slice(0, MAX_RESULTS);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
