"use client";

import { useEffect, useState } from "react";
import type { CaseRecord, Evidence } from "../../../lib/case-schema";
import type { RankedCase } from "../../../lib/rerank";
import type { CaseLocation } from "../../api/cases/[id]/route";
import MapPicker from "../../components/map-picker";

type CaseWithEntries = CaseRecord & {
  entries?: Evidence[];
  locations?: CaseLocation[];
};

interface SimilarResponse {
  results: RankedCase[];
  fresh: boolean;
}

interface PhotoMarking {
  hint?: unknown;
  boxes?: unknown;
}

interface Box {
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
  label?: unknown;
}

const layoutCss = [
  ".trace-case-layout{display:flex;flex-direction:column;gap:1rem}",
  "@media(min-width:48rem){.trace-case-layout{flex-direction:row;align-items:flex-start}",
  ".trace-case-layout>section{flex:1;min-width:0}}",
].join("");

const mainStyle: React.CSSProperties = {
  maxWidth: "56rem",
  margin: "0 auto",
  padding: "1rem",
  fontSize: "1rem",
  lineHeight: 1.5,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: "0.5rem",
  padding: "1rem",
  marginBottom: "1rem",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "#fff3bf",
  border: "1px solid #e6a800",
  borderRadius: "999px",
  padding: "0.25rem 0.75rem",
  fontSize: "0.9rem",
  marginBottom: "1rem",
};

const approveButtonStyle: React.CSSProperties = {
  fontSize: "1rem",
  padding: "0.6rem 1rem",
  cursor: "pointer",
};

function entryNote(entry: Evidence): string {
  return typeof entry.note === "string" ? entry.note : "";
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

function boxesOf(marking: PhotoMarking): Box[] {
  return Array.isArray(marking.boxes) ? (marking.boxes as Box[]) : [];
}

function EntryView({ entry }: { entry: Evidence }) {
  const note = entryNote(entry);
  if (entry.type === "transcript") {
    return (
      <li>
        <strong>İfade: </strong>
        {note || "(boş çözüm metni)"}
      </li>
    );
  }
  if (entry.type === "photo-marking") {
    const marking = parsePhotoMarking(note);
    if (!marking) {
      return (
        <li>
          <strong>Fotoğraf: </strong>
          {note || "(işaret bilgisi okunamadı)"}
        </li>
      );
    }
    const hint = typeof marking.hint === "string" ? marking.hint : "";
    const boxes = boxesOf(marking);
    return (
      <li>
        <strong>Fotoğraf{hint ? `: ${hint}` : ""} </strong>({boxes.length} kutu)
        {boxes.length > 0 ? (
          <ul>
            {boxes.map((b, i) => (
              <li key={i}>
                {typeof b.label === "string" && b.label ? b.label : `kutu ${i + 1}`}
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <strong>{entry.type}: </strong>
      {note}
    </li>
  );
}

function fieldRow(label: string, value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  return (
    <p>
      <strong>{label}: </strong>
      {text}
    </p>
  );
}

export function CaseDetail({ caseId: id }: { caseId: string }) {
  const [caseItem, setCaseItem] = useState<CaseWithEntries | null>(null);
  const [caseMissing, setCaseMissing] = useState(false);
  const [similar, setSimilar] = useState<SimilarResponse | null>(null);
  const [similarError, setSimilarError] = useState("");
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [approveError, setApproveError] = useState<Record<string, string>>({});
  const [approving, setApproving] = useState<Record<string, boolean>>({});
  const [togglingStatus, setTogglingStatus] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/cases/${id}`);
        if (!res.ok) {
          if (!cancelled) setCaseMissing(true);
          return;
        }
        const found = (await res.json()) as CaseWithEntries;
        if (!cancelled) {
          if (found && found.id === id) setCaseItem(found);
          else setCaseMissing(true);
        }
      } catch {
        if (!cancelled) setCaseMissing(true);
      }
      try {
        const res = await fetch(`/api/cases/${id}/similar`);
        if (!res.ok) {
          if (!cancelled) setSimilarError("Benzer vakalar alınamadı.");
          return;
        }
        const body = (await res.json()) as SimilarResponse;
        if (!cancelled) {
          setSimilar({
            results: Array.isArray(body.results) ? body.results : [],
            fresh: body.fresh !== false,
          });
        }
      } catch {
        if (!cancelled) setSimilarError("Bağlantı hatası, tekrar deneyin.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function toggleStatus() {
    if (!caseItem || togglingStatus) return;
    setTogglingStatus(true);
    try {
      const next = caseItem.status === "closed" ? "open" : "closed";
      const res = await fetch(`/api/cases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === "open" || body.status === "closed") {
          setCaseItem({ ...caseItem, status: body.status });
        }
      }
    } catch {
      // Sessiz geç: durum düğmesi kritik akışı engellemez.
    } finally {
      setTogglingStatus(false);
    }
  }

  async function approve(targetId: string) {    setApproving((cur) => ({ ...cur, [targetId]: true }));
    setApproveError((cur) => ({ ...cur, [targetId]: "" }));
    try {
      const res = await fetch(`/api/cases/${id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) {
        setApproveError((cur) => ({
          ...cur,
          [targetId]: "Onay kaydedilemedi.",
        }));
        return;
      }
      setApproved((cur) => ({ ...cur, [targetId]: true }));
    } catch {
      setApproveError((cur) => ({
        ...cur,
        [targetId]: "Bağlantı hatası, tekrar deneyin.",
      }));
    } finally {
      setApproving((cur) => ({ ...cur, [targetId]: false }));
    }
  }

  if (caseMissing) {
    return (
      <main style={mainStyle}>
        <p>Vaka bulunamadı.</p>
      </main>
    );
  }
  if (!caseItem) {
    return (
      <main style={mainStyle}>
        <p>Yükleniyor…</p>
      </main>
    );
  }

  const showFreshBadge = similar?.fresh === false || caseItem.needsRerank === true;
  const entries = Array.isArray(caseItem.entries) ? caseItem.entries : [];

  return (
    <main style={mainStyle}>
      <style>{layoutCss}</style>
      <h1>Vaka {caseItem.caseNo}</h1>
      <p>
        <button
          type="button"
          disabled={togglingStatus}
          onClick={() => void toggleStatus()}
          style={approveButtonStyle}
        >
          {caseItem.status === "closed" ? "Vakayı Aç" : "Vakayı Kapat"}
        </button>
      </p>
      {showFreshBadge ? <p style={badgeStyle}>yeni benzerler</p> : null}
      <div className="trace-case-layout">
        <section aria-label="Vaka detayı" style={cardStyle}>
          <h2>Vaka detayı</h2>
          <p>{caseItem.summary}</p>
          {fieldRow("Suç tipi", caseItem.crimeType)}
          {fieldRow("Konum tipi", caseItem.locationType)}
          {fieldRow("Konum", caseItem.locationText)}
          {fieldRow("Yöntem", caseItem.mo)}
          {fieldRow("Silah", caseItem.weapon)}
          {fieldRow("Durum", caseItem.status)}
          {fieldRow("Memur", caseItem.officer)}
          <h3>Deliller ({entries.length})</h3>          {caseItem.status !== "closed" ? (
            <p>
              <a href={`/cases/${caseItem.id}/edit`}>Vakayı Düzenle</a>
            </p>
          ) : null}
          {entries.length === 0 ? (
            <p>Delil yok.</p>
          ) : (
            <ul>
              {entries.map((e) => (
                <EntryView key={e.id} entry={e} />
              ))}
            </ul>
          )}
          <h3>
            Konumlar (
            {Array.isArray(caseItem.locations) ? caseItem.locations.length : 0})
          </h3>
          {Array.isArray(caseItem.locations) &&
          caseItem.locations.length > 0 ? (
            <>
              <ul>
                {caseItem.locations.map((l) => (
                  <li key={l.id}>
                    {l.note ? <strong>{l.note} </strong> : null}
                    {l.locationText ? <span>{l.locationText} </span> : null}
                    {typeof l.latitude === "number" &&
                    typeof l.longitude === "number" ? (
                      <span>
                        ({l.latitude.toFixed(4)}, {l.longitude.toFixed(4)})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <MapPicker
                readOnly
                points={caseItem.locations
                  .filter(
                    (l) =>
                      typeof l.latitude === "number" &&
                      typeof l.longitude === "number",
                  )
                  .map((l) => ({
                    latitude: l.latitude as number,
                    longitude: l.longitude as number,
                    note: l.note,
                  }))}
              />
            </>
          ) : (
            <p>Konum yok.</p>
          )}
        </section>
        <section aria-label="Benzer vakalar" style={cardStyle}>
          <h2>Benzer vakalar</h2>
          {similarError ? <p role="alert">{similarError}</p> : null}
          {!similar && !similarError ? <p>Yükleniyor…</p> : null}
          {similar && similar.results.length === 0 ? (
            <p>Benzer vaka yok.</p>
          ) : null}
          {similar && similar.results.length > 0 ? (
            <ul aria-label="Benzer vaka listesi">
              {similar.results.map((r) => (
                <li key={r.caseId} style={cardStyle}>
                  <p>
                    <strong>Vaka: </strong>
                    <a href={`/cases/${r.caseId}`}>{r.caseId}</a>
                  </p>
                  <p>
                    <strong>skor: </strong>
                    {r.score === 0 ? "0 (puanlanmadı)" : String(r.score)}
                  </p>
                  <p>
                    <strong>gerekçe: </strong>
                    {r.reason}
                  </p>
                  {typeof r.quote === "string" && r.quote.trim().length > 0 ? (
                    <p>
                      <strong>alıntı: </strong>
                      {r.quote}
                    </p>
                  ) : null}
                  {Array.isArray(r.matchedFields) && r.matchedFields.length > 0 ? (
                    <p>
                      <strong>eşleşen alanlar: </strong>
                      {r.matchedFields.join(", ")}
                    </p>
                  ) : null}
                  {approved[r.caseId] ? (
                    <p>onaylandı</p>
                  ) : (
                    <button
                      type="button"
                      disabled={approving[r.caseId] === true}
                      onClick={() => void approve(r.caseId)}
                      style={approveButtonStyle}
                    >
                      alakalı
                    </button>
                  )}
                  {approveError[r.caseId] ? (
                    <p role="alert">{approveError[r.caseId]}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
