"use client";

import { useState } from "react";
import PersonEditor from "./person-editor";
import {
  personTypeColor,
  personTypeLabel,
  victimLabel,
  type CasePersonDraft,
} from "../../lib/persons";
import { evidenceFileUrl } from "../../lib/evidences";

export interface PeopleSectionProps {
  persons: CasePersonDraft[];
  onChange: (persons: CasePersonDraft[]) => void;
  idPrefix: string;
  readOnly?: boolean;
  onSave?: () => void | Promise<void>;
  onReset?: () => void;
  dirty?: boolean;
  status?: string;
}

const textStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  color: "var(--text)",
};

function clearRelationsTo(persons: CasePersonDraft[], victimId: string): CasePersonDraft[] {
  return persons.map((p) =>
    p.relatedVictimId === victimId
      ? { ...p, relatedVictimId: "", relationship: "" }
      : p,
  );
}

export function PeopleSection({
  persons,
  onChange,
  idPrefix,
  readOnly = false,
  onSave,
  onReset,
  dirty,
  status,
}: PeopleSectionProps) {
  // undefined: panel closed, null: new person, draft: person being edited.
  const [editor, setEditor] = useState<CasePersonDraft | null | undefined>(undefined);

  function handleConfirm(draft: CasePersonDraft) {
    if (editor) {
      let next = persons.map((p) => (p.id === editor.id ? draft : p));
      // When a victim is converted to another type, relations pointing to them are cleared.
      if (editor.type === "victim" && draft.type !== "victim") {
        next = clearRelationsTo(next, draft.id);
      }
      onChange(next);
    } else {
      onChange([...persons, draft]);
    }
    setEditor(undefined);
  }

  function removePerson(person: CasePersonDraft) {
    let next = persons.filter((p) => p.id !== person.id);
    if (person.type === "victim") {
      next = clearRelationsTo(next, person.id);
    }
    onChange(next);
  }

  const victimsForEditor = persons.filter(
    (p) => p.type === "victim" && (!editor || p.id !== editor.id),
  );

  return (
    <section
      aria-labelledby={`${idPrefix}-kisiler-baslik`}
      className="record-section"
      style={{ ...textStyle, margin: "0 0 1rem" }}
    >
      <div className="record-head">
        <h2 id={`${idPrefix}-kisiler-baslik`}>People</h2>
        <span className="record-count">
          {persons.length} {persons.length === 1 ? "person" : "people"}
        </span>
      </div>

      {persons.length === 0 ? <p style={textStyle}>No people added.</p> : null}
      <ul className="record-list">
        {persons.map((person) => {
          const color = personTypeColor(person.type);
          const victims = persons.filter((p) => p.type === "victim");
          const relatedVictim =
            person.type !== "victim" && person.relatedVictimId
              ? persons.find((p) => p.id === person.relatedVictimId)
              : undefined;
          const displayName = person.name
            ? person.type === "victim"
              ? victimLabel(person, victims)
              : person.name
            : person.type === "victim"
              ? victimLabel(person, victims)
              : "";
          const initials =
            displayName
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase())
              .join("") || "?";
          return (
            <li key={person.id} className="record-card" style={textStyle}>
              <span className="avatar" style={{ background: color.bg, color: color.fg }} aria-hidden="true">
                {initials}
              </span>
              <div className="record-main">
                <div>
                  <strong>{displayName}</strong>{" "}
                  <span className="badge-small" style={{ background: color.bg, color: color.fg }}>
                    {personTypeLabel(person.type)}
                  </span>{" "}
                  {person.unidentified ? (
                    <span className="badge-small" style={{ background: "#FFD400", color: "#000000" }}>
                      Unidentified
                    </span>
                  ) : null}{" "}
                  {person.contactStatus === "reached" ? (
                    <span className="badge-small" style={{ background: "#005C1F", color: "#FFFFFF" }}>
                      Reached
                    </span>
                  ) : person.contactStatus === "unreached" ? (
                    <span className="badge-small" style={{ background: "#B34700", color: "#FFFFFF" }}>
                      Not reached
                    </span>
                  ) : null}
                </div>
                {person.age || person.gender ? (
                  <p className="record-meta">
                    {person.age ? `Age: ${person.age}` : ""}
                    {person.age && person.gender ? " · " : ""}
                    {person.gender || ""}
                  </p>
                ) : null}
                {person.note ? <p className="record-note">{person.note}</p> : null}
                {relatedVictim ? (
                  <p className="record-meta">
                    Related Victim: {victimLabel(relatedVictim, victims)}
                    {person.relationship ? ` (${person.relationship})` : ""}
                  </p>
                ) : null}
                {person.type !== "victim" && person.audioFile && !person.removeAudio ? (
                  <audio
                    controls
                    src={evidenceFileUrl(person.audioFile)}
                    style={{ display: "block", margin: "0.6rem 0 0", width: "min(100%, 26rem)", maxWidth: "100%" }}
                  />
                ) : person.type !== "victim" && person.audio ? (
                  <p className="record-meta">Interview audio (unsaved): {person.audio.name}</p>
                ) : null}
              </div>
              {!readOnly ? (
                <div className="record-actions">
                  <button type="button" className="btn-ghost" onClick={() => setEditor(person)}>
                    Edit
                  </button>
                  <button type="button" className="btn-danger" onClick={() => removePerson(person)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <button type="button" className="btn-add" onClick={() => setEditor(null)}>
          + Add Person
        </button>
      ) : null}

      {status ? (
        <p aria-live="polite" style={textStyle}>{status}</p>
      ) : null}

      {dirty && !readOnly ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button type="button" className="btn-save-solid" onClick={() => void onSave?.()}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={() => onReset?.()}>
            Cancel
          </button>
        </div>
      ) : null}

      {editor !== undefined ? (
        <PersonEditor
          initial={editor}
          victims={victimsForEditor}
          onClose={() => setEditor(undefined)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </section>
  );
}

export default PeopleSection;
