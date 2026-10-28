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
        <a href="/new">+ New Case</a>
      </p>
      {failed ? <p role="alert">Could not load cases.</p> : null}
      {!failed && cases === null ? <p>Loading…</p> : null}
      {cases !== null ? (
        <>
          <section aria-label="Active cases">
            <h2>Active Cases ({cases.filter((c) => c.status !== "closed").length})</h2>
            <CaseList
              items={cases.filter((c) => c.status !== "closed")}
              empty="No active cases."
            />
          </section>
          <section aria-label="Past cases">
            <h2>Past Cases ({cases.filter((c) => c.status === "closed").length})</h2>
            <CaseList
              items={cases.filter((c) => c.status === "closed")}
              empty="No past cases."
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
