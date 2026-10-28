"use client";

import { useEffect, useState } from "react";
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
  color: "var(--text)",
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
  const [lightbox, setLightbox] = useState(false);
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

  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <>
      {imageSrc ? (
        <button
          type="button"
          className="ev-thumb-btn"
          onClick={() => setLightbox(true)}
          aria-label={`Enlarge photo: ${evidence.title}`}
        >
          <img className="ev-thumb" src={imageSrc} alt={evidence.title} />
          <span className="ev-zoom">Enlarge</span>
        </button>
      ) : null}
      {lightbox && imageSrc ? (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo: ${evidence.title}`}
          onClick={() => setLightbox(false)}
        >
          <button
            type="button"
            className="lightbox-close"
            aria-label="Close photo"
            onClick={() => setLightbox(false)}
          >
            ×
          </button>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={imageSrc} alt={evidence.title} />
            <figcaption>
              {evidence.title}
              {showNote ? <span>{evidence.note}</span> : null}
            </figcaption>
          </figure>
        </div>
      ) : null}
      <div className="record-main">
        <div>
          <strong>{evidence.title}</strong>{" "}
          {isPhotoMarking ? (
            <span className="chip">
              Photo evidence · {marking ? `${boxes.length} boxes` : "marking unreadable"}
            </span>
          ) : evidence.imageFile || evidence.image ? (
            <span className="chip">Photo</span>
          ) : evidence.audioFile || evidence.audio ? (
            <span className="chip">Audio</span>
          ) : (
            <span className="chip">Note</span>
          )}
        </div>
        {isPhotoMarking && !marking && evidence.note ? (
          <p className="record-note">{evidence.note}</p>
        ) : null}
        {showNote ? <p className="record-note">{evidence.note}</p> : null}
        {evidence.image && !imageSrc ? (
          <p className="record-meta">Image: {evidence.image.name}</p>
        ) : null}
        {evidence.audio && !audioSrc ? (
          <p className="record-meta">Audio: {evidence.audio.name}</p>
        ) : null}
        {audioSrc ? (
          <audio
            controls
            src={audioSrc}
            style={{ display: "block", margin: "0.6rem 0 0", width: "min(100%, 26rem)", maxWidth: "100%" }}
          />
        ) : null}
      </div>
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
      className="record-section"
      style={{ ...textStyle, margin: "0 0 1rem" }}
    >
      <div className="record-head">
        <h2 id={`${idPrefix}-deliller-baslik`}>Evidence</h2>
        <span className="record-count">
          {evidences.length} {evidences.length === 1 ? "item" : "items"}
        </span>
      </div>

      {evidences.length === 0 ? <p style={textStyle}>No evidence added.</p> : null}
      <ul className="record-list">
        {evidences.map((evidence) => (
          <li key={evidence.id} className="record-card" style={textStyle}>
            <EvidenceCard evidence={evidence} />
            {!readOnly ? (
              <div className="record-actions">
                <button type="button" className="btn-ghost" onClick={() => setEditor(evidence)}>
                  Edit
                </button>
                <button type="button" className="btn-danger" onClick={() => removeEvidence(evidence)}>
                  Delete
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {!readOnly ? (
        <button type="button" className="btn-add" onClick={() => setEditor(null)}>
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
          <button type="button" className="btn-save-solid" onClick={() => void onSave?.()}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={() => onReset?.()}>
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
