"use client";

import { useId, useState } from "react";
import {
  evidenceFileUrl,
  validateEvidenceDraft,
  type CaseEvidenceDraft,
} from "../../lib/evidences";

interface EvidenceEditorProps {
  initial: CaseEvidenceDraft | null;
  onClose: () => void;
  onConfirm: (draft: CaseEvidenceDraft) => void;
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

let fallbackIdCounter = 0;
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `evidence-${Date.now()}-${(++fallbackIdCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function EvidenceEditor({
  initial,
  onClose,
  onConfirm,
}: EvidenceEditorProps) {
  const isEdit = initial !== null;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `${uid}-${name}`;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [image, setImage] = useState<File | null>(initial?.image ?? null);
  const [audio, setAudio] = useState<File | null>(initial?.audio ?? null);
  const [removeImage, setRemoveImage] = useState(initial?.removeImage ?? false);
  const [removeAudio, setRemoveAudio] = useState(initial?.removeAudio ?? false);
  const [error, setError] = useState("");

  function buildDraft(): CaseEvidenceDraft {
    return {
      id: initial?.id ?? newId(),
      title: title.trim(),
      note: note.trim(),
      type: initial?.type ?? "evidence",
      imageFile: initial?.imageFile ?? null,
      audioFile: initial?.audioFile ?? null,
      image,
      audio,
      removeImage,
      removeAudio,
    };
  }

  function handleConfirm() {
    const draft = buildDraft();
    const message = validateEvidenceDraft(draft);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    onConfirm(draft);
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
        aria-label={isEdit ? "Edit Evidence" : "Add Evidence"}
        className="editor-dialog"
        style={textStyle}
      >
        <div className="editor-head">
          <div>
            <h2>{isEdit ? "Edit Evidence" : "Add Evidence"}</h2>
            <p className="editor-sub">
              A title plus a photo, an audio file or a note is enough — you
              can complete the rest later.
            </p>
          </div>
          <button type="button" className="editor-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="editor-body">

        <label htmlFor={id("title")} style={textStyle}>
          Evidence Title *
        </label>
        <input
          id={id("title")}
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          style={fieldStyle}
        />

        <label htmlFor={id("image")} style={textStyle}>
          Image
        </label>
        <input
          id={id("image")}
          type="file"
          accept="image/*"
          onChange={(e) => {
            setImage(e.target.files?.[0] ?? null);
            setRemoveImage(false);
            setError("");
          }}
          style={fieldStyle}
        />
        {image ? (
          <p style={textStyle}>Selected image: {image.name}</p>
        ) : initial?.imageFile && !removeImage ? (
          <p style={textStyle}>
            <img
              src={evidenceFileUrl(initial.imageFile)}
              alt={initial.title}
              style={{ maxWidth: "100%", maxHeight: "12rem", display: "block" }}
            />{" "}
            <button type="button" onClick={() => setRemoveImage(true)} className="btn-danger">
              Remove Image
            </button>
          </p>
        ) : null}

        <label htmlFor={id("audio")} style={textStyle}>
          Audio
        </label>
        <input
          id={id("audio")}
          type="file"
          accept="audio/*"
          onChange={(e) => {
            setAudio(e.target.files?.[0] ?? null);
            setRemoveAudio(false);
            setError("");
          }}
          style={fieldStyle}
        />
        {audio ? (
          <p style={textStyle}>Selected audio: {audio.name}</p>
        ) : initial?.audioFile && !removeAudio ? (
          <p style={textStyle}>
            <audio controls src={evidenceFileUrl(initial.audioFile)} />{" "}
            <button type="button" onClick={() => setRemoveAudio(true)} className="btn-danger">
              Remove Audio
            </button>
          </p>
        ) : null}

        <label htmlFor={id("note")} style={textStyle}>
          Note
        </label>
        <textarea
          id={id("note")}
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError("");
          }}
          style={fieldStyle}
        />

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
            {isEdit ? "Save" : "Use Evidence"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EvidenceEditor;
