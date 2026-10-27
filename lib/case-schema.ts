export interface Evidence {
  id: string;
  caseId: string;
  type: string;
  note?: string;
  createdAt: string;
}

export interface CaseLocationInput {
  note?: string | null;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface CaseInput {
  summary: string;
  crimeType?: string | null;
  locationType?: string | null;
  locationText?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  occurredAt?: string | null;
  officer?: string | null;
  victimAge?: number | null;
  victimGender?: string | null;
  suspects?: string | null;
  witnesses?: string | null;
  mo?: string | null;
  weapon?: string | null;
  status?: string | null;
}

export interface CreateCaseInput extends CaseInput {
  locations?: CaseLocationInput[];
}

export interface CaseRecord extends CaseInput {
  id: string;
  caseNo: string;
  needsRerank: boolean;
  createdAt: string;
  updatedAt: string;
}

const CASE_TEXT_FIELDS = [
  "crimeType",
  "locationType",
  "locationText",
  "occurredAt",
  "officer",
  "victimGender",
  "suspects",
  "witnesses",
  "mo",
  "weapon",
  "status",
] as const;

const CASE_NUMBER_FIELDS = ["latitude", "longitude", "victimAge"] as const;

function normalizeText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) throw new Error(`${field} must be a number`);
  return num;
}

function normalizeLocations(value: unknown): CaseLocationInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("locations must be an array");
  return value.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`locations[${i}] must be an object`);
    }
    const loc = item as Record<string, unknown>;
    const out: CaseLocationInput = {
      note: normalizeText(loc.note, `locations[${i}].note`),
      locationText: normalizeText(
        loc.locationText,
        `locations[${i}].locationText`,
      ),
      latitude: normalizeNumber(loc.latitude, `locations[${i}].latitude`),
      longitude: normalizeNumber(loc.longitude, `locations[${i}].longitude`),
    };
    if (!out.locationText && out.latitude === null && out.longitude === null) {
      throw new Error(`locations[${i}] needs locationText or coordinates`);
    }
    return out;
  });
}

export function validateCaseInput(raw: unknown): CreateCaseInput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("case input must be an object");
  }
  const input = raw as Record<string, unknown>;
  if (typeof input.summary !== "string" || input.summary.trim().length === 0) {
    throw new Error("summary is required");
  }
  const out: CreateCaseInput = { summary: input.summary.trim() };
  for (const field of CASE_TEXT_FIELDS) {
    const v = normalizeText(input[field], field);
    if (v !== null || field in input) out[field] = v;
  }
  for (const field of CASE_NUMBER_FIELDS) {
    const v = normalizeNumber(input[field], field);
    if (v !== null || field in input) out[field] = v;
  }
  if (out.victimAge !== null && out.victimAge !== undefined) {
    if (!Number.isInteger(out.victimAge) || out.victimAge < 0 || out.victimAge > 120) {
      throw new Error("victimAge must be an integer between 0 and 120");
    }
  }
  if (out.status !== null && out.status !== undefined && out.status !== "open" && out.status !== "closed") {
    throw new Error("status must be 'open' or 'closed'");
  }
  const locations = normalizeLocations(input.locations);
  if (locations !== undefined) out.locations = locations;
  return out;
}
