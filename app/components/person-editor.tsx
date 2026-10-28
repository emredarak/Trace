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
  color: "#111111",
};

const fieldStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  lineHeight: 1.5,
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
  color: "#111111",
  background: "#ffffff",
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
      onKeyDown={(e) => {
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
        boxSizing: "border-box",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Person" : "Add Person"}
        style={{
          background: "#ffffff",
          color: "#111111",
          width: "100%",
          maxWidth: "40rem",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: "0.6rem",
          padding: "1.25rem",
          boxSizing: "border-box",
          ...textStyle,
        }}
      >
        <h2 style={{ ...textStyle, fontSize: "1.25rem", margin: "0 0 1rem" }}>
          {isEdit ? "Edit Person" : "Add Person"}
        </h2>

        <fieldset style={{ margin: "0 0 1rem", padding: "0.75rem" }}>
          <legend style={textStyle}>Type</legend>
          {PERSON_TYPES.map((t) => (
            <label
              key={t}
              style={{ ...textStyle, display: "block", marginBottom: "0.5rem" }}
            >
              <input
                type="radio"
                name={id("type")}
                checked={type === t}
                onChange={() => setType(t)}
              />{" "}
              {personTypeLabel(t)}
            </label>
          ))}
          <p style={{ ...textStyle, margin: "0.5rem 0 0" }}>
            <span
              style={{
                ...badgeStyle,
                background: typeColor.bg,
                color: typeColor.fg,
              }}
            >
              {personTypeLabel(type)}
            </span>
          </p>
        </fieldset>

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
                  style={buttonStyle}
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

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={buttonStyle}>
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} style={buttonStyle}>
            {isEdit ? "Save" : "Use This Person"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PersonEditor;
