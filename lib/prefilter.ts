import type Database from "better-sqlite3";

export interface CaseFeatures {
  summary?: string;
  crimeType?: string;
  locationType?: string;
  weapon?: string;
  mo?: string;
}

export interface Candidate {
  caseId: string;
  matchedFields: string[];
}

const SEARCHABLE_FIELDS = [
  "summary",
  "crimeType",
  "locationType",
  "weapon",
  "mo",
] as const;

const MAX_CANDIDATES = 20;

function tokenize(value: string): string[] {
  const tokens = value.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return [...new Set(tokens)];
}

function quoteToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

export function prefilter(
  db: Database.Database,
  features: CaseFeatures,
  limit = MAX_CANDIDATES,
): Candidate[] {
  const capped = Math.max(0, Math.min(limit, MAX_CANDIDATES));
  if (capped === 0) return [];

  const fieldTokens = new Map<string, string[]>();
  for (const field of SEARCHABLE_FIELDS) {
    const value = features[field];
    if (typeof value === "string" && value.trim().length > 0) {
      const tokens = tokenize(value);
      if (tokens.length > 0) fieldTokens.set(field, tokens);
    }
  }
  if (fieldTokens.size === 0) return [];

  const parts: string[] = [];
  for (const [field, tokens] of fieldTokens) {
    for (const token of tokens) parts.push(`${field} : ${quoteToken(token)}`);
  }
  const matchQuery = parts.join(" OR ");

  interface FtsRow {
    id: string;
    summary: string | null;
    crimeType: string | null;
    locationType: string | null;
    weapon: string | null;
    mo: string | null;
  }

  const rows = db
    .prepare(
      `SELECT c.id AS id, c.summary AS summary, c.crimeType AS crimeType,
              c.locationType AS locationType, c.weapon AS weapon, c.mo AS mo
       FROM case_fts
       JOIN cases c ON c.rowid = case_fts.rowid
       WHERE case_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(matchQuery, capped) as FtsRow[];

  const candidates: Candidate[] = [];
  for (const row of rows) {
    const matchedFields: string[] = [];
    for (const [field, tokens] of fieldTokens) {
      const cell: string | null = row[field as keyof Omit<FtsRow, "id">];
      if (typeof cell === "string") {
        const lower = cell.toLowerCase();
        if (tokens.some((t) => lower.includes(t.toLowerCase()))) {
          matchedFields.push(field);
        }
      }
    }
    if (matchedFields.length > 0) {
      candidates.push({ caseId: row.id, matchedFields });
    }
  }
  return candidates;
}
