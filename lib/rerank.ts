import type { CaseRecord } from "./case-schema";
import { chatCompletion as defaultChatCompletion } from "./meta-client";
import type { CaseFeatures } from "./prefilter";

export interface RankedCase {
  caseId: string;
  score: number;
  reason: string;
  quote: string;
  matchedFields: string[];
}

// Injectable client seam: tests pass a fake, production uses meta-client.
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
  a: string | undefined,
  b: string | undefined,
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
    `özet: ${c.summary}`,
    c.crimeType ? `suç türü: ${c.crimeType}` : "",
    c.locationType ? `konum türü: ${c.locationType}` : "",
    c.weapon ? `silah: ${c.weapon}` : "",
    c.mo ? `yöntem: ${c.mo}` : "",
  ].filter(Boolean);
  return `- ${parts.join(" | ")}`;
}

function buildPrompt(cases: CaseRecord[], query: CaseRecord): string {
  return [
    "Aşağıdaki sorgu vakaya en çok benzeyen aday vakaları puanla.",
    "",
    `Sorgu vaka: ${describeCase(query)}`,
    "",
    "Aday vakalar:",
    ...cases.map((c) => describeCase(c)),
    "",
    "Yalnızca şu JSON dizisini döndür, başka metin yazma:",
    '[{"caseId": "<aday id>", "score": <1-10 benzerlik puanı>, "reason": "<kısa gerekçe>", "quote": "<adaydan kısa alıntı>"}]',
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
    if (!Array.isArray(parsed)) throw new Error("model yanıtı dizi değil");

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
            : "model gerekçe vermedi",
        quote:
          typeof entry.quote === "string" && entry.quote.trim().length > 0
            ? entry.quote.trim()
            : (candidate.summary ?? ""),
        matchedFields: matchedFieldsFor(query, candidate),
      });
    }
    if (seen.size === 0) throw new Error("model yanıtında geçerli aday yok");

    scored.sort((x, y) => y.score - x.score);
    // Modelin atladığı adayları puansız ekle (kayıp yok), sonra ilk 5.
    for (const c of cases) {
      if (!seen.has(c.id)) scored.push(toUnscored(c, query, "model listesinde yok"));
    }
    return scored.slice(0, MAX_RESULTS);
  } catch {
    // Bozuk yanıt / istemci hatası: adayları puansız, giriş sırasıyla listele.
    return cases.map((c) =>
      toUnscored(c, query, "model yanıtı kullanılamadı"),
    );
  }
}
