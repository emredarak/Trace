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
  color: "#f1f5f9",
};

const buttonStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.6rem 1rem",
  color: "#111111",
  background: "#ffffff",
  border: "1px solid #111111",
  borderRadius: "0.4rem",
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  padding: "0.25rem 0.6rem",
  borderRadius: "0.4rem",
  fontSize: "1rem",
  lineHeight: 1.5,
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
  // undefined: panel kapalı, null: yeni kişi, draft: düzenlenen kişi.
  const [editor, setEditor] = useState<CasePersonDraft | null | undefined>(undefined);

  function handleConfirm(draft: CasePersonDraft) {
    if (editor) {
      let next = persons.map((p) => (p.id === editor.id ? draft : p));
      // Maktül başka türe çevrildiyse ona bağlı ilişkiler boşalır.
      if (editor.type === "maktul" && draft.type !== "maktul") {
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
    if (person.type === "maktul") {
      next = clearRelationsTo(next, person.id);
    }
    onChange(next);
  }

  const victimsForEditor = persons.filter(
    (p) => p.type === "maktul" && (!editor || p.id !== editor.id),
  );

  return (
    <section
      aria-labelledby={`${idPrefix}-kisiler-baslik`}
      style={{
        ...textStyle,
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: "0.6rem",
        padding: "1rem",
        margin: "0 0 1rem",
      }}
    >
      <h2
        id={`${idPrefix}-kisiler-baslik`}
        style={{ ...textStyle, fontSize: "1.25rem", margin: "0 0 1rem" }}
      >
        Kişiler
      </h2>

      {persons.length === 0 ? <p style={textStyle}>Ekli kişi yok.</p> : null}
      <ul style={{ paddingLeft: "1.25rem" }}>
        {persons.map((person) => {
          const color = personTypeColor(person.type);
          const victims = persons.filter((p) => p.type === "maktul");
          const relatedVictim =
            person.type !== "maktul" && person.relatedVictimId
              ? persons.find((p) => p.id === person.relatedVictimId)
              : undefined;
          return (
            <li
              key={person.id}
              style={{
                ...textStyle,
                marginBottom: "0.75rem",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: "0.6rem",
                padding: "0.9rem 1rem",
              }}
            >
              {person.name ? (
                <strong>
                  {person.type === "maktul"
                    ? victimLabel(person, victims)
                    : person.name}{" "}
                </strong>
              ) : person.type === "maktul" ? (
                <span>{victimLabel(person, victims)} </span>
              ) : null}
              <span style={{ ...badgeStyle, background: color.bg, color: color.fg }}>
                {personTypeLabel(person.type)}
              </span>{" "}
              {person.age ? <span>Yaş: {person.age} </span> : null}
              {person.gender ? <span>{person.gender} </span> : null}
              {person.note ? <span>{person.note} </span> : null}
              {relatedVictim ? (
                <span>
                  İlişkili Maktül: {victimLabel(relatedVictim, victims)}
                  {person.relationship ? ` (${person.relationship})` : ""}{" "}
                </span>
              ) : null}
              {person.unidentified ? (
                <span style={{ ...badgeStyle, background: "#FFD400", color: "#000000" }}>
                  Kimliği Tespit Edilemedi
                </span>
              ) : null}{" "}
              {person.contactStatus === "ulasildi" ? (
                <span style={{ ...badgeStyle, background: "#005C1F", color: "#FFFFFF" }}>
                  Ulaşıldı
                </span>
              ) : person.contactStatus === "ulasilamadi" ? (
                <span style={{ ...badgeStyle, background: "#B34700", color: "#FFFFFF" }}>
                  Ulaşılamadı
                </span>
              ) : null}{" "}
              {person.type !== "maktul" && person.audioFile && !person.removeAudio ? (
                <audio
                  controls
                  src={evidenceFileUrl(person.audioFile)}
                  style={{ display: "block", margin: "0.5rem 0" }}
                />
              ) : person.type !== "maktul" && person.audio ? (
                <span>Sorgu sesi (kaydedilmedi): {person.audio.name} </span>
              ) : null}
              {!readOnly ? (
                <>
                  <button type="button" onClick={() => setEditor(person)} style={buttonStyle}>
                    Düzenle
                  </button>{" "}
                  <button type="button" onClick={() => removePerson(person)} style={buttonStyle}>
                    Sil
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <button type="button" onClick={() => setEditor(null)} style={buttonStyle}>
          + Kişi Ekle
        </button>
      ) : null}

      {status ? (
        <p aria-live="polite" style={textStyle}>{status}</p>
      ) : null}

      {dirty && !readOnly ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button type="button" onClick={() => void onSave?.()} style={buttonStyle}>
            Kaydet
          </button>
          <button type="button" onClick={() => onReset?.()} style={buttonStyle}>
            Vazgeç
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
