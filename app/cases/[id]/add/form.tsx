"use client";

import { useRef, useState } from "react";

export const EVIDENCE_TYPES = [
  "firearm",
  "casing",
  "trace",
  "biological",
  "document",
  "other",
];

const wrap: React.CSSProperties = {
  maxWidth: "62rem",
  margin: "0 auto",
  padding: "1.75rem clamp(1rem,3vw,2.5rem) 4rem",
  fontSize: "1rem",
  lineHeight: 1.55,
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
    fontSize: "0.95rem",
    padding: "0.55rem 1rem",
    borderRadius: "999px",
    border: selected ? "1px solid var(--accent)" : "1px solid var(--line)",
    background: selected ? "var(--accent)" : "var(--panel-2)",
    color: selected ? "var(--accent-ink)" : "var(--text)",
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

  // When the service worker queues an offline record it returns 202 {queued:true}.
  // In real fetch a 202 has ok=true, so the queue flag is read from the parsed body
  // BEFORE branching on res.ok.
  interface ApiBody {
    queued?: boolean;
    boxes?: unknown;
    transcript?: { text?: string };
  }

  async function readBody(res: Response): Promise<ApiBody | null> {
    try {
      return (await res.json()) as ApiBody;
    } catch {
      return null;
    }
  }

  async function saveNote() {
    if (note.trim().length === 0 && !type) {
      setStatus("A note or evidence type is required.");
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
      const body = await readBody(res);
      if (body?.queued === true) {
        setStatus("Note queued, will be sent once you're back online.");
        setNote("");
      } else if (res.ok) {
        setStatus("Note saved.");
        setNote("");
      } else {
        setStatus("Could not save note.");
      }
    } catch {
      setStatus("Connection error, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    const hint = type || note.trim() || "evidence";
    const form = new FormData();
    form.append("file", file);
    form.append("hint", hint);
    setBusy(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/mark-photo`, {
        method: "POST",
        body: form,
      });
      const body = await readBody(res);
      if (body?.queued === true) {
        setStatus("Photo queued, will be processed once you're back online.");
        return;
      }
      if (!res.ok) {
        setStatus("Could not annotate photo.");
        return;
      }
      const n = Array.isArray(body?.boxes) ? body.boxes.length : 0;
      setStatus(`Photo saved (${n} boxes).`);
    } catch {
      setStatus("Connection error, please try again.");
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
      const body = await readBody(res);
      if (body?.queued === true) {
        setStatus("Audio queued, will be transcribed once you're back online.");
        return;
      }
      if (!res.ok) {
        setStatus("Could not transcribe audio.");
        return;
      }
      setStatus(`Audio transcribed: ${body?.transcript?.text ?? ""}`);
    } catch {
      setStatus("Connection error, please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={wrap}>
      <h1>Add Evidence</h1>

      <div role="group" aria-label="Evidence type" style={chipRow}>
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

      <label htmlFor="not">Note</label>
      <textarea
        id="not"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={field}
      />
      <button type="button" disabled={busy} onClick={saveNote} style={button}>
        Save Note
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
        Take Photo
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
        Record Audio
      </button>

      {status ? <p aria-live="polite">{status}</p> : null}
    </main>
  );
}
