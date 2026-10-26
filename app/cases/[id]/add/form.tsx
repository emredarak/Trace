"use client";

import { useRef, useState } from "react";

export const EVIDENCE_TYPES = [
  "ateşli silah",
  "kovan",
  "iz",
  "biyolojik",
  "belge",
  "diğer",
];

const wrap: React.CSSProperties = {
  maxWidth: "28rem",
  margin: "0 auto",
  padding: "1rem",
  fontSize: "1rem",
  lineHeight: 1.5,
};

const field: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  fontSize: "1rem",
  padding: "0.75rem",
  margin: "0.25rem 0 1rem",
};

const button: React.CSSProperties = {
  display: "block",
  width: "100%",
  fontSize: "1.1rem",
  padding: "0.9rem",
  marginBottom: "0.75rem",
  cursor: "pointer",
};

const chipRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  margin: "0.25rem 0 1rem",
};

function chipStyle(selected: boolean): React.CSSProperties {
  return {
    fontSize: "1rem",
    padding: "0.6rem 1rem",
    borderRadius: "999px",
    border: selected ? "2px solid black" : "1px solid gray",
    background: selected ? "#eee" : "white",
    cursor: "pointer",
  };
}

export default function AddEvidenceForm({ caseId }: { caseId: string }) {
  const [type, setType] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  async function saveNote() {
    if (note.trim().length === 0 && !type) {
      setStatus("Not ya da delil tipi gerekli.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type || "note",
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      setStatus(res.ok ? "Not kaydedildi." : "Not kaydedilemedi.");
      if (res.ok) setNote("");
    } catch {
      setStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    const hint = type || note.trim() || "delil";
    const form = new FormData();
    form.append("file", file);
    form.append("hint", hint);
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/mark-photo`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        setStatus("Fotoğraf işaretlenemedi.");
        return;
      }
      const body = await res.json();
      const n = Array.isArray(body.boxes) ? body.boxes.length : 0;
      setStatus(`Fotoğraf kaydedildi (${n} kutu).`);
    } catch {
      setStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadAudio(file: File) {
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/transcribe`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        setStatus("Ses çözülemedi.");
        return;
      }
      const body = await res.json();
      setStatus(`Ses çözüldü: ${body.transcript?.text ?? ""}`);
    } catch {
      setStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={wrap}>
      <h1>Delil Ekle</h1>

      <div role="group" aria-label="Delil tipi" style={chipRow}>
        {EVIDENCE_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => setType((cur) => (cur === t ? "" : t))}
            style={chipStyle(type === t)}
          >
            {t}
          </button>
        ))}
      </div>

      <label htmlFor="not">Not</label>
      <textarea
        id="not"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={field}
      />
      <button type="button" disabled={busy} onClick={saveNote} style={button}>
        Not Kaydet
      </button>

      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadPhoto(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => photoRef.current?.click()}
        style={button}
      >
        Fotoğraf Çek
      </button>

      <input
        ref={audioRef}
        type="file"
        accept="audio/*"
        capture
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadAudio(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => audioRef.current?.click()}
        style={button}
      >
        Ses Kaydet
      </button>

      {status ? <p aria-live="polite">{status}</p> : null}
    </main>
  );
}
