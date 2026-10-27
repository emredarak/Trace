"use client";

import { useId, useState } from "react";
import {
  personTypeColor,
  personTypeLabel,
  type CasePersonDraft,
  type PersonType,
} from "../../lib/persons";

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

const PERSON_TYPES: PersonType[] = ["maktul", "tanik", "supheli"];

const CONTACT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Belirtilmedi" },
  { value: "ulasildi", label: "Ulaşıldı" },
  { value: "ulasilamadi", label: "Ulaşılamadı" },
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

  const [type, setType] = useState<PersonType>(initial?.type ?? "maktul");
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
  const [error, setError] = useState("");

  const typeColor = personTypeColor(type);
  const contactBadge =
    contactStatus === "ulasildi"
      ? { bg: "#005C1F", fg: "#FFFFFF", label: "Ulaşıldı" }
      : contactStatus === "ulasilamadi"
        ? { bg: "#B34700", fg: "#FFFFFF", label: "Ulaşılamadı" }
        : null;

  function handleConfirm() {
    if (!unidentified && !name.trim()) {
      setError("Ad Soyad zorunludur.");
      return;
    }
    const ageText = age.trim();
    if (ageText !== "") {
      const ageNum = Number(ageText);
      if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) {
        setError("Yaş 0 ile 120 arasında bir tam sayı olmalıdır.");
        return;
      }
    }
    setError("");
    const related = type === "maktul" ? "" : relatedVictimId;
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
        aria-label={isEdit ? "Kişiyi Düzenle" : "Kişi Ekle"}
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
          {isEdit ? "Kişiyi Düzenle" : "Kişi Ekle"}
        </h2>

        <fieldset style={{ margin: "0 0 1rem", padding: "0.75rem" }}>
          <legend style={textStyle}>Tür</legend>
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
          Ad Soyad
        </label>
        <input
          id={id("name")}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={fieldStyle}
        />

        <label htmlFor={id("age")} style={textStyle}>
          Yaş
        </label>
        <input
          id={id("age")}
          type="number"
          min={0}
          max={120}
          value={age}
          onChange={(e) => setAge(e.target.value)}
          style={fieldStyle}
        />

        <label htmlFor={id("gender")} style={textStyle}>
          Cinsiyet
        </label>
        <select
          id={id("gender")}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          style={fieldStyle}
        >
          <option value=""></option>
          <option value="kadın">kadın</option>
          <option value="erkek">erkek</option>
          <option value="bilinmiyor">bilinmiyor</option>
        </select>

        <label htmlFor={id("note")} style={textStyle}>
          Not
        </label>
        <input
          id={id("note")}
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={fieldStyle}
        />

        {type !== "maktul" ? (
          <>
            <label htmlFor={id("relatedVictimId")} style={textStyle}>
              İlişkili Maktül
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
                  {victim.name.trim()
                    ? victim.name
                    : "Kimliği tespit edilemedi"}
                </option>
              ))}
            </select>

            <label htmlFor={id("relationship")} style={textStyle}>
              İlişki
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
            onChange={(e) => setUnidentified(e.target.checked)}
          />{" "}
          Kimliği Tespit Edilemedi
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
              Kimliği Tespit Edilemedi
            </span>
          </p>
        ) : null}

        <label htmlFor={id("contactStatus")} style={textStyle}>
          Ulaşılma Durumu
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

        {error ? (
          <p role="alert" style={textStyle}>
            {error}
          </p>
        ) : null}

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={buttonStyle}>
            Vazgeç
          </button>
          <button type="button" onClick={handleConfirm} style={buttonStyle}>
            {isEdit ? "Kaydet" : "Kişiyi Kullan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PersonEditor;
