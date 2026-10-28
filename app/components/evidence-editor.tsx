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
      onKeyDown={(e) => {
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
        aria-label={isEdit ? "Delili Düzenle" : "Delil Ekle"}
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
          {isEdit ? "Delili Düzenle" : "Delil Ekle"}
        </h2>

        <label htmlFor={id("title")} style={textStyle}>
          Delil Başlığı *
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
          Görsel
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
          <p style={textStyle}>Seçili görsel: {image.name}</p>
        ) : initial?.imageFile && !removeImage ? (
          <p style={textStyle}>
            <img
              src={evidenceFileUrl(initial.imageFile)}
              alt={initial.title}
              style={{ maxWidth: "100%", maxHeight: "12rem", display: "block" }}
            />{" "}
            <button type="button" onClick={() => setRemoveImage(true)} style={buttonStyle}>
              Görseli Kaldır
            </button>
          </p>
        ) : null}

        <label htmlFor={id("audio")} style={textStyle}>
          Ses
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
          <p style={textStyle}>Seçili ses: {audio.name}</p>
        ) : initial?.audioFile && !removeAudio ? (
          <p style={textStyle}>
            <audio controls src={evidenceFileUrl(initial.audioFile)} />{" "}
            <button type="button" onClick={() => setRemoveAudio(true)} style={buttonStyle}>
              Sesi Kaldır
            </button>
          </p>
        ) : null}

        <label htmlFor={id("note")} style={textStyle}>
          Not
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

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button type="button" onClick={onClose} style={buttonStyle}>
            Vazgeç
          </button>
          <button type="button" onClick={handleConfirm} style={buttonStyle}>
            {isEdit ? "Kaydet" : "Delili Kullan"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EvidenceEditor;
