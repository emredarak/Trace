"use client";

import { useEffect, useState } from "react";
import type { CaseRecord } from "../lib/case-schema";

export default function Home() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/cases");
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const list = (await res.json()) as CaseRecord[];
        if (!cancelled) setCases(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Trace</h1>
      <p>
        <a href="/new">+ Yeni Vaka</a>
      </p>
      {failed ? <p role="alert">Vakalar alınamadı.</p> : null}
      {!failed && cases === null ? <p>Yükleniyor…</p> : null}
      {cases !== null ? (
        <>
          <section aria-label="Aktif vakalar">
            <h2>Aktif Vakalar ({cases.filter((c) => c.status !== "closed").length})</h2>
            <CaseList
              items={cases.filter((c) => c.status !== "closed")}
              empty="Aktif vaka yok."
            />
          </section>
          <section aria-label="Geçmiş vakalar">
            <h2>Geçmiş Vakalar ({cases.filter((c) => c.status === "closed").length})</h2>
            <CaseList
              items={cases.filter((c) => c.status === "closed")}
              empty="Geçmiş vaka yok."
            />
          </section>
        </>
      ) : null}
    </main>
  );
}

function CaseList({ items, empty }: { items: CaseRecord[]; empty: string }) {
  if (items.length === 0) return <p>{empty}</p>;
  return (
    <ul>
      {items.map((c) => (
        <li key={c.id}>
          <a href={`/cases/${c.id}`}>
            {c.caseNo} — {c.summary.slice(0, 80)}
            {c.summary.length > 80 ? "…" : ""}
          </a>
        </li>
      ))}
    </ul>
  );
}
