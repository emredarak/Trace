"use client";

import { useState, type ReactNode } from "react";
import LocationsSection from "./locations-section";
import PeopleSection from "./people-section";
import EvidenceSection from "./evidence-section";
import type { CaseLocationDraft } from "../../lib/locations";
import type { CasePersonDraft } from "../../lib/persons";
import type { CaseEvidenceDraft } from "../../lib/evidences";

export type { CaseLocationDraft } from "../../lib/locations";
export type { CasePersonDraft } from "../../lib/persons";

// Single field definition for the case create and case edit screens.
// Add new fields here; both screens pick them up automatically.
export const CRIME_SUGGESTIONS = [
  "theft",
  "robbery",
  "homicide",
  "assault",
  "fraud",
  "arson",
  "traffic accident",
  "missing person",
];

export const WEAPON_SUGGESTIONS = [
  "knife",
  "firearm",
  "crowbar",
  "baton",
  "stone",
  "screwdriver",
  "none",
  "other",
];

export interface CaseFormValues {
  summary: string;
  occurredAt: string;
  crimeType: string;
  mo: string;
  weapon: string;
}

export type CaseFormPayload = {
  summary: string;
  occurredAt: string | null;
  crimeType: string | null;
  mo: string | null;
  weapon: string | null;
};

export function emptyCaseForm(): CaseFormValues {
  return {
    summary: "",
    occurredAt: "",
    crimeType: "",
    mo: "",
    weapon: "",
  };
}

interface CaseLike {
  summary?: string | null;
  occurredAt?: string | null;
  crimeType?: string | null;
  mo?: string | null;
  weapon?: string | null;
}

export function caseToFormValues(c: CaseLike): CaseFormValues {
  const str = (v: string | null | undefined) => (v == null ? "" : String(v));
  return {
    summary: str(c.summary),
    occurredAt: c.occurredAt ? String(c.occurredAt).slice(0, 16) : "",
    crimeType: str(c.crimeType),
    mo: str(c.mo),
    weapon: str(c.weapon),
  };
}

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
};

const hintStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  color: "var(--text)",
  margin: "-0.6rem 0 1rem",
};

interface CaseFormProps {
  idPrefix: string;
  initial: CaseFormValues;
  initialLocations?: CaseLocationDraft[];
  initialPersons?: CasePersonDraft[];
  initialEvidences?: CaseEvidenceDraft[];
  header?: ReactNode;
  submitLabel: string;
  saving?: boolean;
  error?: string;
  onSubmit: (
    payload: CaseFormPayload,
    locations: CaseLocationDraft[],
    persons: CasePersonDraft[],
    evidences: CaseEvidenceDraft[],
  ) => Promise<void>;
}

export default function CaseForm({
  idPrefix,
  initial,
  initialLocations = [],
  initialPersons = [],
  initialEvidences = [],
  header,
  submitLabel,
  saving = false,
  error = "",
  onSubmit,
}: CaseFormProps) {
  const [values, setValues] = useState<CaseFormValues>(initial);
  const [formError, setFormError] = useState("");
  const [locations, setLocations] =
    useState<CaseLocationDraft[]>(initialLocations);
  const [persons, setPersons] = useState<CasePersonDraft[]>(initialPersons);
  const [evidences, setEvidences] =
    useState<CaseEvidenceDraft[]>(initialEvidences);

  const set = (key: keyof CaseFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (values.summary.trim().length === 0) {
      setFormError("Summary is required.");
      return;
    }
    setFormError("");
    const text = (v: string) => {
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    await onSubmit(
      {
        summary: values.summary.trim(),
        occurredAt: text(values.occurredAt),
        crimeType: text(values.crimeType),
        mo: text(values.mo),
        weapon: text(values.weapon),
      },
      locations,
      persons,
      evidences,
    );
  }

  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <>
      {header}
      <form onSubmit={handleSubmit}>
        <fieldset>
          <legend>Incident details</legend>
          <label htmlFor={id("summary")}>Summary *</label>
          <textarea
            id={id("summary")}
            aria-label="Summary"
            rows={3}
            value={values.summary}
            onChange={set("summary")}
            style={fieldStyle}
            placeholder="Briefly describe the incident; similar case search uses this text."
          />
          <label htmlFor={id("occurredAt")}>Incident date and time</label>
          <input
            id={id("occurredAt")}
            type="datetime-local"
            value={values.occurredAt}
            onChange={set("occurredAt")}
            style={fieldStyle}
          />
          <label htmlFor={id("crimeType")}>Crime type</label>
          <input
            id={id("crimeType")}
            type="text"
            list={id("crime-list")}
            value={values.crimeType}
            onChange={set("crimeType")}
            style={fieldStyle}
            placeholder="Select or type your own"
          />
          <datalist id={id("crime-list")}>
            {CRIME_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <label htmlFor={id("mo")}>Method / modus operandi (MO)</label>
          <textarea
            id={id("mo")}
            rows={2}
            value={values.mo}
            onChange={set("mo")}
            style={fieldStyle}
            placeholder="E.g. approaching from behind at night"
          />
          <p style={hintStyle}>Helps find older cases that used the same method.</p>
          <label htmlFor={id("weapon")}>Weapon / tool</label>
          <input
            id={id("weapon")}
            type="text"
            list={id("weapon-list")}
            value={values.weapon}
            onChange={set("weapon")}
            style={fieldStyle}
            placeholder="Select or type your own; leave empty if none"
          />
          <datalist id={id("weapon-list")}>
            {WEAPON_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </fieldset>

        <PeopleSection
          persons={persons}
          onChange={setPersons}
          idPrefix={idPrefix}
        />

        <LocationsSection
          locations={locations}
          onChange={setLocations}
          idPrefix={idPrefix}
        />

        <EvidenceSection
          evidences={evidences}
          onChange={setEvidences}
          idPrefix={idPrefix}
        />

        {formError ? <p role="alert">{formError}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </form>
    </>
  );
}
