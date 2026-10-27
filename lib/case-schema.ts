import type { LocationKind, LocationPriority } from "./locations";
import { normalizePersonsInput, type NormalizedPerson } from "./persons";

export type { LocationKind, LocationPriority };
export type { NormalizedPerson };

export interface Evidence {
  id: string;
  caseId: string;
  type: string;
  note?: string;
  createdAt: string;
}

export interface CaseLocationInput {
  title?: string;
  note?: string | null;
  locationText?: string | null;
  kind?: LocationKind;
  priority?: LocationPriority | null;
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
  persons?: NormalizedPerson[];
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

const LOCATION_KINDS: readonly string[] = ["olay-yeri", "iliskili"];
const LOCATION_PRIORITIES: readonly string[] = ["kritik", "onemli", "rutin"];

export function normalizeLocationInput(
  raw: unknown,
  prefix = "location",
): Required<CaseLocationInput> {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${prefix} must be an object`);
  }
  const loc = raw as Record<string, unknown>;
  const titleRaw = normalizeText(loc.title, `${prefix}.title`);
  const noteRaw = normalizeText(loc.note, `${prefix}.note`);
  const locationTextRaw = normalizeText(
    loc.locationText,
    `${prefix}.locationText`,
  );
  const latitude = normalizeNumber(loc.latitude, `${prefix}.latitude`);
  const longitude = normalizeNumber(loc.longitude, `${prefix}.longitude`);
  if ((latitude === null) !== (longitude === null)) {
    throw new Error(
      `${prefix} latitude and longitude must be provided together`,
    );
  }
  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new Error(`${prefix}.latitude must be between -90 and 90`);
  }
  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new Error(`${prefix}.longitude must be between -180 and 180`);
  }

  let kind: LocationKind = "iliskili";
  if (loc.kind !== undefined && loc.kind !== null && loc.kind !== "") {
    if (typeof loc.kind !== "string" || !LOCATION_KINDS.includes(loc.kind)) {
      throw new Error(`${prefix}.kind must be 'olay-yeri' or 'iliskili'`);
    }
    kind = loc.kind as LocationKind;
  }

  let priority: LocationPriority | null = null;
  if (loc.priority !== undefined && loc.priority !== null && loc.priority !== "") {
    if (
      typeof loc.priority !== "string" ||
      !LOCATION_PRIORITIES.includes(loc.priority)
    ) {
      throw new Error(
        `${prefix}.priority must be 'kritik', 'onemli' or 'rutin'`,
      );
    }
    priority = loc.priority as LocationPriority;
  }
  if (kind === "olay-yeri") priority = null;

  let title: string;
  let note: string | null;
  if (titleRaw) {
    title = titleRaw;
    note = noteRaw ?? locationTextRaw;
  } else if (noteRaw) {
    title = noteRaw;
    note = locationTextRaw ?? null;
  } else if (locationTextRaw) {
    title = locationTextRaw;
    note = null;
  } else if (latitude !== null && longitude !== null) {
    title = "Konum";
    note = null;
  } else {
    throw new Error(`${prefix} needs a title or coordinates`);
  }

  return {
    title,
    note,
    locationText: note,
    kind,
    priority,
    latitude,
    longitude,
  };
}

export interface LocationResponse {
  id: string;
  caseId: string;
  title: string;
  note: string | null;
  locationText: string | null;
  kind: LocationKind;
  priority: LocationPriority | null;
  latitude?: number;
  longitude?: number;
  createdAt: string;
}

// Ham DB satırını API yanıtına çevirir; eski satırlarda boş başlık/tür
// görüntü amaçlı varsayılanlara düşer (veri taşınmaz).
export function toLocationResponse(
  row: Record<string, unknown>,
): LocationResponse {
  const title =
    typeof row.title === "string" && row.title.trim()
      ? row.title.trim()
      : "Konum";
  const kind: LocationKind =
    typeof row.kind === "string" && LOCATION_KINDS.includes(row.kind)
      ? (row.kind as LocationKind)
      : "iliskili";
  let priority: LocationPriority | null =
    typeof row.priority === "string" &&
    LOCATION_PRIORITIES.includes(row.priority)
      ? (row.priority as LocationPriority)
      : null;
  if (kind === "olay-yeri") priority = null;
  // Eski veri taşınmaz: note yalnızca row.note'tan gelir; locationText
  // onun aliasıdır, boş note eski locationText ile doldurulmaz.
  const note =
    typeof row.note === "string" && row.note.trim() ? row.note.trim() : null;
  return {
    id: String(row.id),
    caseId: String(row.caseId),
    title,
    note,
    locationText: note,
    kind,
    priority,
    latitude: typeof row.latitude === "number" ? row.latitude : undefined,
    longitude: typeof row.longitude === "number" ? row.longitude : undefined,
    createdAt: String(row.createdAt),
  };
}

function normalizeLocations(value: unknown): CaseLocationInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("locations must be an array");
  return value.map((item, i) => normalizeLocationInput(item, `locations[${i}]`));
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
  if (input.persons !== undefined) out.persons = normalizePersonsInput(input.persons);
  return out;
}
