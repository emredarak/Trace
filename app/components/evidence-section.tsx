"use client";

import { useState } from "react";
import EvidenceEditor from "./evidence-editor";
import {
  evidenceFileUrl,
  type CaseEvidenceDraft,
} from "../../lib/evidences";

export interface EvidenceSectionProps {
  evidences: CaseEvidenceDraft[];
  onChange: (evidences: CaseEvidenceDraft[]) => void;
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

interface PhotoMarking {
  hint?: unknown;
  boxes?: unknown;
}

function parsePhotoMarking(note: string): PhotoMarking | null {
  try {
    const parsed: unknown = JSON.parse(note);
    if (typeof parsed === "object" && parsed !== null) return parsed as PhotoMarking;
    return null;
  } catch {
    return null;
  }
}

function objectUrl(file: File): string | null {
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(file);
    }
  } catch {
    return null;
  }
  return null;
}

function EvidenceCard({ evidence }: { evidence: CaseEvidenceDraft }) {
  const isPhotoMarking = evidence.type === "photo-marking";
  const marking = isPhotoMarking ? parsePhotoMarking(evidence.note) : null;
  const boxes = marking && Array.isArray(marking.boxes) ? marking.boxes : [];
  const showNote = evidence.note && !isPhotoMarking;
  const imageSrc = evidence.image
    ? objectUrl(evidence.image)
    : evidence.imageFile && !evidence.removeImage
      ? evidenceFileUrl(evidence.imageFile)
      : null;
  const audioSrc = evidence.audio
    ? objectUrl(evidence.audio)
    : evidence.audioFile && !evidence.removeAudio
      ? evidenceFileUrl(evidence.audioFile)
      : null;
  return (
    <>
      <strong>{evidence.title} </strong>
      {isPhotoMarking ? (
        <span>
          {marking
            ? `(${boxes.length} boxes) `
            : `${evidence.note || "(marking info unreadable)"} `}
        </span>
      ) : null}
      {showNote ? <span>{evidence.note} </span> : null}
      {evidence.image && !imageSrc ? <span>Image: {evidence.image.name} </span> : null}
      {evidence.audio && !audioSrc ? <span>Audio: {evidence.audio.name} </span> : null}
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={evidence.title}
          style={{ maxWidth: "100%", maxHeight: "14rem", display: "block", margin: "0.5rem 0" }}
        />
      ) : null}
      {audioSrc ? (
        <audio controls src={audioSrc} style={{ display: "block", margin: "0.5rem 0" }} />
      ) : null}
    </>
  );
}

export function EvidenceSection({
  evidences,
  onChange,
  idPrefix,
  readOnly = false,
  onSave,
  onReset,
  dirty,
  status,
}: EvidenceSectionProps) {
  // undefined: panel closed, null: new evidence, draft: evidence being edited.
  const [editor, setEditor] = useState<CaseEvidenceDraft | null | undefined>(undefined);

  function handleConfirm(draft: CaseEvidenceDraft) {
    if (editor) {
      onChange(evidences.map((e) => (e.id === editor.id ? draft : e)));
    } else {
      onChange([...evidences, draft]);
    }
    setEditor(undefined);
  }

  function removeEvidence(evidence: CaseEvidenceDraft) {
    onChange(evidences.filter((e) => e.id !== evidence.id));
  }

  return (
    <section
      aria-labelledby={`${idPrefix}-deliller-baslik`}
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
        id={`${idPrefix}-deliller-baslik`}
        style={{ ...textStyle, fontSize: "1.25rem", margin: "0 0 1rem" }}
      >
        Evidence
      </h2>

      {evidences.length === 0 ? <p style={textStyle}>No evidence added.</p> : null}
      <ul style={{ paddingLeft: "1.25rem" }}>
        {evidences.map((evidence) => (
          <li
            key={evidence.id}
            style={{
              ...textStyle,
              marginBottom: "0.75rem",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "0.6rem",
              padding: "0.9rem 1rem",
            }}
          >
            <EvidenceCard evidence={evidence} />
            {!readOnly ? (
              <>
                <button type="button" onClick={() => setEditor(evidence)} style={buttonStyle}>
                  Edit
                </button>{" "}
                <button type="button" onClick={() => removeEvidence(evidence)} style={buttonStyle}>
                  Delete
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      {!readOnly ? (
        <button type="button" onClick={() => setEditor(null)} style={buttonStyle}>
          + Add Evidence
        </button>
      ) : null}

      {status ? (
        <p aria-live="polite" style={textStyle}>
          {status}
        </p>
      ) : null}

      {dirty && !readOnly ? (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button type="button" onClick={() => void onSave?.()} style={buttonStyle}>
            Save
          </button>
          <button type="button" onClick={() => onReset?.()} style={buttonStyle}>
            Cancel
          </button>
        </div>
      ) : null}

      {editor !== undefined ? (
        <EvidenceEditor
          initial={editor}
          onClose={() => setEditor(undefined)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </section>
  );
}

export default EvidenceSection;
