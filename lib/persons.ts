export type PersonType = "maktul" | "tanik" | "supheli";
export type ContactStatus = "ulasildi" | "ulasilamadi";

export const PERSON_GENDERS = ["kadın", "erkek", "bilinmiyor"] as const;

export interface NormalizedPerson {
  id?: string;
  name: string | null;
  age: number | null;
  gender: string | null;
  note: string | null;
  type: PersonType;
  relatedVictimId: string | null;
  relationship: string | null;
  unidentified: boolean;
  contactStatus: ContactStatus | null;
}

const PERSON_TYPES: readonly string[] = ["maktul", "tanik", "supheli"];
const CONTACT_STATUSES: readonly string[] = ["ulasildi", "ulasilamadi"];

const TYPE_COLORS: Record<PersonType, { bg: string; fg: string }> = {
  maktul: { bg: "#990000", fg: "#FFFFFF" },
  supheli: { bg: "#6B21A8", fg: "#FFFFFF" },
  tanik: { bg: "#0050A0", fg: "#FFFFFF" },
};

export function personTypeLabel(type: PersonType): string {
  switch (type) {
    case "maktul":
      return "Maktül";
    case "tanik":
      return "Tanık";
    case "supheli":
      return "Şüpheli";
    default:
      return "Kişi";
  }
}

export function personTypeColor(type: PersonType): { bg: string; fg: string } {
  return TYPE_COLORS[type] ?? { bg: "#5A5A5A", fg: "#FFFFFF" };
}

function normalizeText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePersonInput(raw: unknown): NormalizedPerson {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("person must be an object");
  }
  const person = raw as Record<string, unknown>;

  let id: string | undefined;
  const idRaw = normalizeText(person.id, "person.id");
  if (idRaw !== null) id = idRaw;

  if (
    typeof person.type !== "string" ||
    !PERSON_TYPES.includes(person.type)
  ) {
    throw new Error("person.type must be 'maktul', 'tanik' or 'supheli'");
  }
  const type = person.type as PersonType;

  let unidentified = false;
  if (person.unidentified !== undefined && person.unidentified !== null) {
    if (typeof person.unidentified !== "boolean") {
      throw new Error("person.unidentified must be a boolean");
    }
    unidentified = person.unidentified;
  }

  const name = normalizeText(person.name, "person.name");
  if (name === null && !unidentified) {
    throw new Error("person.name is required");
  }

  let age: number | null = null;
  if (person.age !== undefined && person.age !== null && person.age !== "") {
    const num =
      typeof person.age === "number"
        ? person.age
        : typeof person.age === "string"
          ? Number(person.age)
          : NaN;
    if (!Number.isInteger(num) || num < 0 || num > 120) {
      throw new Error("person.age must be an integer between 0 and 120");
    }
    age = num;
  }

  const gender = normalizeText(person.gender, "person.gender");
  if (gender !== null && !(PERSON_GENDERS as readonly string[]).includes(gender)) {
    throw new Error("person.gender must be 'kadın', 'erkek' or 'bilinmiyor'");
  }

  const note = normalizeText(person.note, "person.note");

  let contactStatus: ContactStatus | null = null;
  const contactRaw = normalizeText(person.contactStatus, "person.contactStatus");
  if (contactRaw !== null) {
    if (!CONTACT_STATUSES.includes(contactRaw)) {
      throw new Error("person.contactStatus must be 'ulasildi' or 'ulasilamadi'");
    }
    contactStatus = contactRaw as ContactStatus;
  }

  let relatedVictimId = normalizeText(
    person.relatedVictimId,
    "person.relatedVictimId",
  );
  let relationship = normalizeText(person.relationship, "person.relationship");
  if (type === "maktul" || relatedVictimId === null) {
    relatedVictimId = null;
    relationship = null;
  }

  return {
    ...(id !== undefined ? { id } : {}),
    name,
    age,
    gender,
    note,
    type,
    relatedVictimId,
    relationship,
    unidentified,
    contactStatus,
  };
}

export function normalizePersonsInput(raw: unknown): NormalizedPerson[] {
  if (!Array.isArray(raw)) throw new Error("persons must be an array");
  const persons = raw.map((item) => normalizePersonInput(item));
  const byId = new Map<string, NormalizedPerson>();
  for (const person of persons) {
    if (person.id !== undefined) byId.set(person.id, person);
  }
  for (const person of persons) {
    if (person.relatedVictimId !== null) {
      const target = byId.get(person.relatedVictimId);
      if (!target || target.type !== "maktul") {
        throw new Error(
          "person.relatedVictimId must reference a maktul person in the same case",
        );
      }
    }
  }
  return persons;
}
