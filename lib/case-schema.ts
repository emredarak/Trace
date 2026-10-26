export interface Evidence {
  id: string;
  caseId: string;
  type: string;
  note?: string;
  createdAt: string;
}

export interface CaseInput {
  summary: string;
  crimeType?: string;
  locationType?: string;
  locationText?: string;
  latitude?: number;
  longitude?: number;
  occurredAt?: string;
  officer?: string;
  victimAge?: number;
  victimGender?: string;
  suspects?: string;
  witnesses?: string;
  mo?: string;
  weapon?: string;
  status?: string;
}

export interface CaseRecord extends CaseInput {
  id: string;
  caseNo: string;
  needsRerank: boolean;
  createdAt: string;
  updatedAt: string;
}

export function validateCaseInput(raw: unknown): CaseInput {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("case input must be an object");
  }
  const { summary } = raw as { summary?: unknown };
  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("summary is required");
  }
  return { ...(raw as object), summary } as CaseInput;
}
