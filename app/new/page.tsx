"use client";

import { useState } from "react";
import CaseForm, {
  emptyCaseForm,
  type CaseFormPayload,
} from "../components/case-form";
import type { CaseLocationDraft } from "../../lib/locations";
import type { CasePersonDraft } from "../../lib/persons";

const wrap: React.CSSProperties = {
  maxWidth: "28rem",
  margin: "0 auto",
  padding: "1rem",
  fontSize: "1rem",
  lineHeight: 1.5,
};

interface CreatedBody {
  queued?: boolean;
  id?: unknown;
  caseNo?: unknown;
}

export default function NewCasePage() {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; caseNo: string } | null>(
    null,
  );
  const [queued, setQueued] = useState(false);

  async function onSubmit(
    payload: CaseFormPayload,
    locations: CaseLocationDraft[],
    persons: CasePersonDraft[],
  ) {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          locations: locations.map((l) => ({
            title: l.title,
            note: l.note || null,
            kind: l.kind,
            priority: l.priority,
            latitude: l.latitude ?? null,
            longitude: l.longitude ?? null,
          })),
          persons: persons.map((p) => ({
            id: p.id,
            name: p.name || null,
            age: p.age.trim() ? Number(p.age) : null,
            gender: p.gender || null,
            note: p.note || null,
            type: p.type,
            relatedVictimId:
              p.type === "maktul" ? null : p.relatedVictimId || null,
            relationship:
              p.type !== "maktul" && p.relatedVictimId
                ? p.relationship || null
                : null,
            unidentified: p.unidentified,
            contactStatus: p.contactStatus || null,
          })),
        }),
      });
      let body: CreatedBody | null = null;
      try {
        body = (await res.json()) as CreatedBody;
      } catch {
        body = null;
      }
      if (body?.queued === true) {
        setQueued(true);
        return;
      }
      if (!res.ok) {
        setError("Kayıt açılamadı, tekrar deneyin.");
        return;
      }
      if (
        body &&
        typeof body.id === "string" &&
        typeof body.caseNo === "string"
      ) {
        setCreated({ id: body.id, caseNo: body.caseNo });
      } else {
        setError("Kayıt açılamadı, tekrar deneyin.");
      }
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  if (queued) {
    return (
      <main style={wrap}>
        <h1>Vaka kuyruğa alındı</h1>
        <p>Bağlantı gelince açılacak.</p>
      </main>
    );
  }

  if (created) {
    return (
      <main style={wrap}>
        <h1>Vaka açıldı: {created.caseNo}</h1>
        <p>
          <a href={`/cases/${created.id}`}>Vakayı Gör</a>
        </p>
        <p>
          <a href={`/cases/${created.id}/add`}>Delil ekle</a>
        </p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1>Yeni Vaka</h1>
      <p>
        Vaka numarası ve durum (Açık) sistem tarafından atanır. Yıldızlı alan
        dışında hepsi isteğe bağlıdır; sonra da düzenleyebilirsiniz.
      </p>
      <CaseForm
        idPrefix="yeni"
        initial={emptyCaseForm()}
        submitLabel="Vakayı Aç"
        saving={saving}
        error={error}
        onSubmit={onSubmit}
      />
    </main>
  );
}
