"use client";

import { useId, useState } from "react";
import {
  personTypeColor,
  personTypeLabel,
  victimLabel,
  type CasePersonDraft,
  type PersonType,
} from "../../lib/persons";
import { evidenceFileUrl } from "../../lib/evidences";

interface PersonEditorProps {
  initial: CasePersonDraft | null;
  victims: CasePersonDraft[];
  onClose: () => void;
  onConfirm: (draft: CasePersonDraft) => void;
}

const textStyle: React.CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.5,
  color: "var(--text)",
};

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.7rem 0.8rem",
  margin: "0.25rem 0 1rem",
  color: "var(--text)",
  background: "var(--panel-2)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
};

const badgeStyle: React.CSSProperties = {
  padding: "0.16rem 0.6rem",
  borderRadius: "999px",
  fontSize: "0.78rem",
  fontWeight: 750,
  lineHeight: 1.4,
};

const PERSON_TYPES: PersonType[] = ["victim", "witness", "suspect"];

const CONTACT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Not specified" },
  { value: "reached", label: "Reached" },
  { value: "unreached", label: "Not reached" },
];

let fallbackIdCounter = 0;
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `person-${Date.now()}-${(++fallbackIdCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PersonEditor({
  initial,
  victims,
  onClose,
  onConfirm,
}: PersonEditorProps) {
  const isEdit = initial !== null;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;

  const [type, setType] = useState<PersonType>(initial?.type ?? "victim");
  const [name, setName] = useState(initial?.name ?? "");
  const [age, setAge] = useState(initial?.age ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [relatedVictimId, setRelatedVictimId] = useState(
    initial?.relatedVictimId ?? "",
  );
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [unidentified, setUnidentified] = useState(
    initial?.unidentified ?? false,
  );
  const [contactStatus, setContactStatus] = useState(
    initial?.contactStatus ?? "",
  );
  const [audio, setAudio] = useState<File | null>(initial?.audio ?? null);
  const [removeAudio, setRemoveAudio] = useState(
    initial?.removeAudio ?? false,
  );
  const [error, setError] = useState("");

  const typeColor = personTypeColor(type);
  const contactBadge =
    contactStatus === "reached"
      ? { bg: "#005C1F", fg: "#FFFFFF", label: "Reached" }
      : contactStatus === "unreached"
        ? { bg: "#B34700", fg: "#FFFFFF", label: "Not reached" }
        : null;

  function handleConfirm() {
    if (!unidentified && !name.trim()) {
      setError("Full name is required.");
      return;
    }
    const ageText = age.trim();
    if (ageText !== "") {
      const ageNum = Number(ageText);
      if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) {
        setError("Age must be a whole number between 0 and 120.");
        return;
      }
    }
    setError("");
    const related = type === "victim" ? "" : relatedVictimId;
    onConfirm({
      id: initial?.id ?? newId(),
      name: name.trim(),
      age: ageText,
      gender,
      note: note.trim(),
      type,
      relatedVictimId: related,
      relationship: related ? relationship.trim() : "",
      unidentified,
      contactStatus,
      audioFile: type === "victim" ? null : (initial?.audioFile ?? null),
      audio: type === "victim" ? null : audio,
      removeAudio: type === "victim" ? true : removeAudio,
    });
  }

  return (
    <div
      className="editor-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }
        if (e.key !== "Enter") return;
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) {
          e.preventDefault();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Person" : "Add Person"}
        className="editor-dialog"
        style={textStyle}
      >
        <div className="editor-head">
          <div>
            <h2>{isEdit ? "Edit Person" : "Add Person"}</h2>
            <p className="editor-sub">
              First pick the person&apos;s role, then add the details you
              have — everything except the name can be completed later.
            </p>
          </div>
          <button type="button" className="editor-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="editor-body">
        <p className="editor-section-title">Type</p>
        <div className="choice-row" role="radiogroup" aria-label="Type">
          {PERSON_TYPES.map((t) => (
            <label key={t} className="choice-chip">
              <input
                type="radio"
                name={id("type")}
                checked={type === t}
                onChange={() => setType(t)}
              />{" "}
              {personTypeLabel(t)}
            </label>
          ))}
        </div>

        <p className="editor-section-title">Identity</p>

        <label htmlFor={id("name")} style={textStyle}>
          Full Name
        </label>
        <input
          id={id("name")}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          style={fieldStyle}
        />

        <label htmlFor={id("age")} style={textStyle}>
          Age
        </label>
        <input
          id={id("age")}
          type="number"
          min={0}
          max={120}
          value={age}
          onChange={(e) => {
            setAge(e.target.value);
            setError("");
          }}
          style={fieldStyle}
        />

        <label htmlFor={id("gender")} style={textStyle}>
          Gender
        </label>
        <select
          id={id("gender")}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          style={fieldStyle}
        >
          <option value=""></option>
          <option value="female">female</option>
          <option value="male">male</option>
          <option value="unknown">unknown</option>
        </select>

        <label htmlFor={id("note")} style={textStyle}>
          Note
        </label>
        <input
          id={id("note")}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={fieldStyle}
        />

        {type !== "victim" ? (
          <>
            <label htmlFor={id("relatedVictimId")} style={textStyle}>
              Related Victim
            </label>
            <select
              id={id("relatedVictimId")}
              value={relatedVictimId}
              onChange={(e) => setRelatedVictimId(e.target.value)}
              style={fieldStyle}
            >
              <option value=""></option>
              {victims.map((victim) => (
                <option key={victim.id} value={victim.id}>
                  {victimLabel(victim, victims)}
                </option>
              ))}
            </select>

            <label htmlFor={id("relationship")} style={textStyle}>
              Relationship
            </label>
            <input
              id={id("relationship")}
              type="text"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              style={fieldStyle}
            />
          </>
        ) : null}

        <label style={{ ...textStyle, display: "block", marginBottom: "1rem" }}>
          <input
            type="checkbox"
            checked={unidentified}
            onChange={(e) => {
              setUnidentified(e.target.checked);
              setError("");
            }}
          />{" "}
          Unidentified
        </label>
        {unidentified ? (
          <p style={{ ...textStyle, margin: "0 0 1rem" }}>
            <span
              style={{
                ...badgeStyle,
                background: "#FFD400",
                color: "#000000",
              }}
            >
              Unidentified
            </span>
          </p>
        ) : null}

        <label htmlFor={id("contactStatus")} style={textStyle}>
          Contact Status
        </label>
        <select
          id={id("contactStatus")}
          value={contactStatus}
          onChange={(e) => setContactStatus(e.target.value)}
          style={fieldStyle}
        >
          {CONTACT_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {contactBadge ? (
          <p style={{ ...textStyle, margin: "0 0 1rem" }}>
            <span
              style={{
                ...badgeStyle,
                background: contactBadge.bg,
                color: contactBadge.fg,
              }}
            >
              {contactBadge.label}
            </span>
          </p>
        ) : null}

        {type !== "victim" ? (
          <>
            <label htmlFor={id("audio")} style={textStyle}>
              Interview Audio Recording
            </label>
            <input
              id={id("audio")}
              type="file"
              accept="audio/*"
              onChange={(e) => {
                setAudio(e.target.files?.[0] ?? null);
                setRemoveAudio(false);
              }}
              style={fieldStyle}
            />
            {audio ? (
              <p style={textStyle}>Selected audio: {audio.name}</p>
            ) : initial?.audioFile && !removeAudio ? (
              <p style={textStyle}>
                <audio
                  controls
                  src={evidenceFileUrl(initial.audioFile)}
                  style={{ display: "block", margin: "0.5rem 0" }}
                />{" "}
                <button
                  type="button"
                  onClick={() => setRemoveAudio(true)}
                  className="btn-danger"
                >
                  Remove Audio Recording
                </button>
              </p>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p role="alert" style={textStyle}>
            {error}
          </p>
        ) : null}

        </div>

        <div className="editor-foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-save-solid" onClick={handleConfirm}>
            {isEdit ? "Save" : "Use This Person"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PersonEditor;
