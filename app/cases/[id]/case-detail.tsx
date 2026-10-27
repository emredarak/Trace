"use client";

import { useEffect, useRef, useState } from "react";
import type { CaseRecord, Evidence } from "../../../lib/case-schema";
import type { RankedCase } from "../../../lib/rerank";
import type { CaseLocation } from "../../api/cases/[id]/route";
import { LocationsSection } from "../../components/locations-section";
import type { CaseLocationDraft } from "../../../lib/locations";

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

function toDraft(l: CaseLocation): CaseLocationDraft {
  return {
    id: l.id,
    title: l.title ?? "Konum",
    note: l.note ?? "",
    kind: l.kind ?? "iliskili",
    priority: l.priority ?? null,
    latitude: l.latitude ?? undefined,
    longitude: l.longitude ?? undefined,
  };
}

function locationBody(l: CaseLocationDraft) {
  return {
    title: l.title,
    note: l.note || null,
    kind: l.kind,
    priority: l.kind === "olay-yeri" ? null : l.priority,
    latitude: l.latitude ?? null,
    longitude: l.longitude ?? null,
  };
}

function sameLocation(a: CaseLocationDraft, b: CaseLocationDraft): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.note === b.note &&
    a.kind === b.kind &&
    (a.priority ?? null) === (b.priority ?? null) &&
    (a.latitude ?? null) === (b.latitude ?? null) &&
    (a.longitude ?? null) === (b.longitude ?? null)
  );
}

function sameLocations(
  a: CaseLocationDraft[],
  b: CaseLocationDraft[],
): boolean {
  return a.length === b.length && a.every((l, i) => sameLocation(l, b[i]));
}

function fieldRow(label: string, value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (text.length === 0) return null;
  return (
    <p style={{ whiteSpace: "pre-line" }}>
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
  const [baselineLocations, setBaselineLocations] = useState<
    CaseLocationDraft[]
  >([]);
  const [draftLocations, setDraftLocations] = useState<CaseLocationDraft[]>(
    [],
  );
  const [locationStatus, setLocationStatus] = useState("");
  const savingLocationsRef = useRef(false);

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
          if (found && found.id === id) {
            setCaseItem(found);
            const drafts = (
              Array.isArray(found.locations) ? found.locations : []
            ).map(toDraft);
            setBaselineLocations(drafts);
            setDraftLocations(drafts.map((l) => ({ ...l })));
          } else setCaseMissing(true);
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

  async function saveLocations() {
    // Yeniden giriş koruması: çift tık yinelenen POST yaratmaz.
    if (savingLocationsRef.current) return;
    savingLocationsRef.current = true;
    setLocationStatus("");
    // Başarılı işlemler ara tabana işlenir; kısmi hatada taslak korunur.
    let working = [...baselineLocations];
    // Kimliği sunucudan dönen kopyalarla ilerleyen etkin taslak;
    // state nesneleri doğrudan değiştirilmez.
    let effectiveDraft = draftLocations.map((l) => ({ ...l }));
    let queued = false;
    async function readQueued(res: Response): Promise<string | null> {
      try {
        const body = (await res.json()) as {
          queued?: boolean;
          id?: unknown;
        } | null;
        if (body?.queued === true) queued = true;
        return typeof body?.id === "string" ? body.id : null;
      } catch {
        return null;
      }
    }
    try {
      const baselineById = new Map(baselineLocations.map((l) => [l.id, l]));
      const currentIds = new Set(draftLocations.map((l) => l.id));

      for (let i = 0; i < effectiveDraft.length; i++) {
        const loc = effectiveDraft[i];
        if (!baselineById.has(loc.id)) {
          const locRes = await fetch(`/api/cases/${id}/locations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(locationBody(loc)),
          });
          const createdId = await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          const savedLoc = createdId ? { ...loc, id: createdId } : { ...loc };
          effectiveDraft[i] = savedLoc;
          working = [...working, { ...savedLoc }];
        }
      }

      for (const loc of effectiveDraft) {
        const original = baselineById.get(loc.id);
        if (original && !sameLocation(original, loc)) {
          const locRes = await fetch(
            `/api/cases/${id}/locations/${loc.id}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(locationBody(loc)),
            },
          );
          await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.map((l) => (l.id === loc.id ? { ...loc } : l));
        }
      }

      for (const original of baselineLocations) {
        if (!currentIds.has(original.id)) {
          const locRes = await fetch(
            `/api/cases/${id}/locations/${original.id}`,
            { method: "DELETE" },
          );
          await readQueued(locRes);
          if (!locRes.ok) {
            setBaselineLocations(working);
            setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
            setLocationStatus("Konumlar kaydedilemedi, tekrar deneyin.");
            return;
          }
          working = working.filter((l) => l.id !== original.id);
        }
      }

      const persisted = working.map((l) => ({ ...l }));
      setBaselineLocations(persisted);
      setDraftLocations(persisted.map((l) => ({ ...l })));
      setLocationStatus(
        queued
          ? "Kuyruğa alındı, bağlantı gelince gönderilecek."
          : "Konumlar kaydedildi.",
      );
    } catch {
      setBaselineLocations(working);
      setDraftLocations(effectiveDraft.map((l) => ({ ...l })));
      setLocationStatus("Bağlantı hatası, tekrar deneyin.");
    } finally {
      savingLocationsRef.current = false;
    }
  }

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
  const locationsDirty = !sameLocations(baselineLocations, draftLocations);

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
          {fieldRow("Olay tarihi", caseItem.occurredAt)}
          {fieldRow("Yöntem", caseItem.mo)}
          {fieldRow("Silah", caseItem.weapon)}
          {fieldRow("Durum", caseItem.status === "closed" ? "Kapalı" : "Açık")}
          {fieldRow("Memur", caseItem.officer)}
          {fieldRow("Maktul yaşı", caseItem.victimAge)}
          {fieldRow("Maktul cinsiyeti", caseItem.victimGender)}
          {fieldRow("Şüpheliler", caseItem.suspects)}
          {fieldRow("Tanıklar", caseItem.witnesses)}
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
          <LocationsSection
            locations={draftLocations}
            onChange={(locs) => {
              setDraftLocations(locs);
              setLocationStatus("");
            }}
            idPrefix="detay"
            readOnly={caseItem.status === "closed"}
            dirty={caseItem.status !== "closed" && locationsDirty}
            status={locationStatus}
            onSave={saveLocations}
            onReset={() => {
              setDraftLocations(baselineLocations.map((l) => ({ ...l })));
              setLocationStatus("");
            }}
          />
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
