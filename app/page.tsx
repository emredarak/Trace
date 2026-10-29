"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { CaseRecord } from "../lib/case-schema";
import {
  ageColor,
  ageInDays,
  ageLabel,
  caseDateMs,
} from "../lib/case-age";

const MapPicker = dynamic(() => import("./components/map-picker"), {
  ssr: false,
});

type DrawerTab = "overview" | "details" | "timeline";

function hasCoords(c: CaseRecord): boolean {
  return typeof c.latitude === "number" && typeof c.longitude === "number";
}

function formatCaseDate(c: CaseRecord): string {
  const ms = caseDateMs(c);
  if (ms === null) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Home() {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [showActive, setShowActive] = useState(true);
  const [showClosed, setShowClosed] = useState(true);
  const [onlyLocated, setOnlyLocated] = useState(false);
  const [crimeType, setCrimeType] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<DrawerTab>("overview");

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

  const crimeTypes = useMemo(
    () =>
      Array.from(
        new Set(
          (cases ?? [])
            .map((c) => c.crimeType)
            .filter((v): v is string => Boolean(v)),
        ),
      ).sort(),
    [cases],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (cases ?? []).filter((c) => {
      const isClosed = c.status === "closed";
      if (isClosed && !showClosed) return false;
      if (!isClosed && !showActive) return false;
      if (onlyLocated && !hasCoords(c)) return false;
      if (crimeType !== "all" && c.crimeType !== crimeType) return false;
      if (!q) return true;
      return [c.caseNo, c.summary, c.crimeType, c.locationText, c.officer]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    return [...list].sort((a, b) => {
      if (sort === "caseNo") return a.caseNo.localeCompare(b.caseNo);
      if (sort === "oldest")
        return String(a.createdAt).localeCompare(String(b.createdAt));
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [cases, query, showActive, showClosed, onlyLocated, crimeType, sort]);

  const active = filtered.filter((c) => c.status !== "closed");
  const past = filtered.filter((c) => c.status === "closed");
  const selected =
    filtered.find((c) => c.id === selectedId) ?? active[0] ?? past[0] ?? null;
  const located = filtered.filter(hasCoords);

  function handleSelect(id: string) {
    setSelectedId(id);
    setTab("overview");
    if (typeof document !== "undefined") {
      const reduced =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document
        .querySelector(".drawer")
        ?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    }
  }
  const nowMs = Date.now();
  const locatedAges = located
    .map((c) => ageInDays(c, nowMs))
    .filter((d): d is number => d !== null);
  const minAge = locatedAges.length ? Math.min(...locatedAges) : 0;
  const maxAge = locatedAges.length ? Math.max(...locatedAges) : 0;
  const colorForCase = (c: CaseRecord): string => {
    const age = ageInDays(c, nowMs);
    if (age === null) return "#8a9a8f";
    const t = maxAge > minAge ? (age - minAge) / (maxAge - minAge) : 0;
    return ageColor(t);
  };
  const newestCase = located.length
    ? located.reduce((a, b) =>
        (caseDateMs(b) ?? -Infinity) > (caseDateMs(a) ?? -Infinity) ? b : a,
      )
    : null;
  const oldestCase = located.length
    ? located.reduce((a, b) =>
        (caseDateMs(b) ?? Infinity) < (caseDateMs(a) ?? Infinity) ? b : a,
      )
    : null;
  const mapPoints = located.map((c) => ({
    latitude: c.latitude as number,
    longitude: c.longitude as number,
    title: c.caseNo,
    note: c.locationText ?? c.summary,
    color: colorForCase(c),
    ageLabel: `${formatCaseDate(c)} · ${ageLabel(ageInDays(c, nowMs))}`,
  }));

  return (
    <main>
      <div className="explorer">
        <aside className="explorer-panel" aria-label="Filters">
          <h2>Explore cases</h2>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            Start with the map, narrow with filters, then inspect a case
            without leaving this page.
          </p>

          <div className="filter-group">
            <label htmlFor="case-search">Search</label>
            <input
              id="case-search"
              type="search"
              placeholder="Case no, place, person…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: "100%" }}
            />
          </div>

          <fieldset
            className="filter-group"
            style={{ border: 0, background: "transparent", padding: "0.9rem 0", margin: 0 }}
          >
            <legend className="filter-legend">Status</legend>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={showActive}
                onChange={(e) => setShowActive(e.target.checked)}
              />
              Active cases
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Closed cases
            </label>
            <label className="filter-check">
              <input
                type="checkbox"
                checked={onlyLocated}
                onChange={(e) => setOnlyLocated(e.target.checked)}
              />
              On the map only
            </label>
          </fieldset>

          <div className="filter-group">
            <label htmlFor="crime-type">Crime type</label>
            <select
              id="crime-type"
              className="filter-select"
              value={crimeType}
              onChange={(e) => setCrimeType(e.target.value)}
            >
              <option value="all">All types</option>
              {crimeTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label htmlFor="sort-cases">Sort results</label>
            <select
              id="sort-cases"
              className="filter-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="caseNo">Case number</option>
            </select>
          </div>

          <details className="trace-details">
            <summary>How exploration works</summary>
            <p style={{ color: "var(--muted)" }}>
              Pins are cases with coordinates. Select a result to preview it
              on the right; open the full case only when you need to edit it
              or review similar cases.
            </p>
          </details>
        </aside>

        <section aria-label="Case results">
          <div className="hero-map">
            <div className="hero-map-head">
              <div>
                <h1>Find the pattern in the map.</h1>
                <p>
                  Cases are grouped by where they happened. Pick a pin or a
                  result below — the detail panel follows your selection.
                </p>
              </div>
              <a
                href="/new"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  borderRadius: "999px",
                  padding: "0.6rem 1.1rem",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                + New Case
              </a>
            </div>
            <div className="map-frame">
              {cases === null ? (
                <p className="empty-note" style={{ margin: "1.2rem" }}>
                  Loading map…
                </p>
              ) : located.length > 0 ? (
                <MapPicker points={mapPoints} readOnly height={340} showDistances={false} />
              ) : (
                <p className="empty-note" style={{ margin: "1.2rem" }}>
                  No mapped cases in this view yet. Add coordinates to a case
                  and it will appear here.
                </p>
              )}
            </div>
            {cases !== null && located.length > 0 ? (
              <div
                aria-label="Map colour legend"
                style={{
                  borderTop: "1px solid var(--line-soft)",
                  padding: "0.85rem 1.2rem 1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    fontSize: "0.8rem",
                    fontWeight: 750,
                  }}
                >
                  <span style={{ color: ageColor(0) }}>
                    Newest{newestCase ? ` · ${formatCaseDate(newestCase)}` : ""}
                  </span>
                  <span style={{ color: "var(--muted)", fontWeight: 600 }}>
                    Pin colour = how old the case is
                  </span>
                  <span style={{ color: ageColor(1) }}>
                    Oldest{oldestCase ? ` · ${formatCaseDate(oldestCase)}` : ""}
                  </span>
                </div>
                <div
                  aria-hidden="true"
                  style={{
                    height: "0.55rem",
                    borderRadius: "999px",
                    marginTop: "0.5rem",
                    background:
                      "linear-gradient(90deg, hsl(150 78% 52%), hsl(45 90% 55%), hsl(8 78% 52%))",
                  }}
                />
                <p
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.82rem",
                    margin: "0.55rem 0 0",
                    lineHeight: 1.5,
                  }}
                >
                  Green pins are closest to today, red pins are the oldest.
                  Colours are scaled between the newest and oldest cases
                  currently on the map, so filtering re-scales them. Hover a
                  pin to see its exact date. Grey means the case has no
                  valid date.
                </p>
              </div>
            ) : null}
          </div>

          {failed ? <p role="alert">Could not load cases.</p> : null}
          {!failed && cases === null ? <p>Loading…</p> : null}

          {cases !== null ? (
            <>
              <div className="stat-row" aria-label="Summary">
                <div className="stat">
                  <b>{active.length}</b>
                  <span>Active in view</span>
                </div>
                <div className="stat">
                  <b>{past.length}</b>
                  <span>Closed in view</span>
                </div>
                <div className="stat">
                  <b>{located.length}</b>
                  <span>Shown on map</span>
                </div>
              </div>

              <section aria-label="Active cases">
                <h2>Active Cases ({active.length})</h2>
                <CaseList
                  items={active}
                  empty="No active cases match these filters."
                  selectedId={selected?.id}
                  ageFor={(c) => ({
                    color: colorForCase(c),
                    label: ageLabel(ageInDays(c, nowMs)),
                  })}
                  onSelect={handleSelect}
                />
              </section>
              <section aria-label="Past cases">
                <h2>Past Cases ({past.length})</h2>
                <CaseList
                  items={past}
                  empty="No past cases match these filters."
                  selectedId={selected?.id}
                  ageFor={(c) => ({
                    color: colorForCase(c),
                    label: ageLabel(ageInDays(c, nowMs)),
                  })}
                  onSelect={handleSelect}
                />
              </section>
            </>
          ) : null}
        </section>

        <aside
          className="explorer-panel drawer"
          aria-label="Selected case detail"
        >
          {selected ? (
            <div key={selected.id} className="drawer-pulse">
              <span className="chip gold" data-testid="selected-title">Selected: {selected.caseNo}</span>
              <h2 style={{ fontSize: "1.45rem", marginBottom: "0.3rem" }}>
                {selected.caseNo}
              </h2>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                {selected.summary}
              </p>

              <div className="drawer-tabs" role="tablist" aria-label="Case preview">
                {(
                  [
                    ["overview", "Overview"],
                    ["details", "Details"],
                    ["timeline", "Timeline"],
                  ] as [DrawerTab, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === "overview" ? (
                <>
                  <div className="chips">
                    <span
                      className={`chip ${selected.status === "closed" ? "closed" : "open"}`}
                    >
                      {selected.status === "closed" ? "Closed" : "Active"}
                    </span>
                    {selected.crimeType ? (
                      <span className="chip">{selected.crimeType}</span>
                    ) : null}
                    {hasCoords(selected) ? (
                      <span className="chip gold">On map</span>
                    ) : null}
                  </div>
                  <details className="trace-details" open>
                    <summary>Why start here?</summary>
                    <p style={{ color: "var(--muted)" }}>
                      This preview keeps you oriented. Open the full case to
                      edit evidence, people and locations, and to review
                      similar cases with their evidence.
                    </p>
                  </details>
                  <p>
                    <a
                      href={`/cases/${selected.id}`}
                      style={{
                        display: "inline-block",
                        background: "var(--accent)",
                        color: "var(--accent-ink)",
                        borderRadius: "999px",
                        padding: "0.65rem 1.2rem",
                        textDecoration: "none",
                      }}
                    >
                      Open full case
                    </a>
                  </p>
                </>
              ) : null}

              {tab === "details" ? (
                <dl className="kv">
                  <dt>Crime type</dt>
                  <dd>{selected.crimeType || "—"}</dd>
                  <dt>Incident date</dt>
                  <dd>{selected.occurredAt || "—"}</dd>
                  <dt>Place</dt>
                  <dd>{selected.locationText || "—"}</dd>
                  <dt>Method</dt>
                  <dd>{selected.mo || "—"}</dd>
                  <dt>Weapon</dt>
                  <dd>{selected.weapon || "—"}</dd>
                  <dt>Officer</dt>
                  <dd>{selected.officer || "—"}</dd>
                </dl>
              ) : null}

              {tab === "timeline" ? (
                <dl className="kv">
                  <dt>Status</dt>
                  <dd>{selected.status === "closed" ? "Closed" : "Open"}</dd>
                  <dt>Recorded</dt>
                  <dd>{selected.createdAt || "—"}</dd>
                  <dt>Updated</dt>
                  <dd>{selected.updatedAt || "—"}</dd>
                  <dt>Coordinates</dt>
                  <dd>
                    {hasCoords(selected)
                      ? `${selected.latitude?.toFixed(4)}, ${selected.longitude?.toFixed(4)}`
                      : "Not mapped"}
                  </dd>
                </dl>
              ) : null}
            </div>
          ) : (
            <>
              <h2>Case detail</h2>
              <p className="empty-note">
                Select a case from the results and its preview will appear
                here.
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

function CaseList({
  items,
  empty,
  selectedId,
  onSelect,
  ageFor,
}: {
  items: CaseRecord[];
  empty: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  ageFor?: (c: CaseRecord) => { color: string; label: string };
}) {
  if (items.length === 0) return <p className="empty-note">{empty}</p>;
  return (
    <div>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className={`case-row ${c.id === selectedId ? "selected" : ""}`}
          aria-pressed={c.id === selectedId}
          onClick={() => onSelect(c.id)}
        >
          <span className="case-row-top">
            <span className="case-no">{c.caseNo}</span>
            <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
              {c.occurredAt || ""}
            </span>
          </span>
          <span
            className="case-summary"
            style={{ display: "block", color: "var(--muted)", marginTop: "0.25rem" }}
          >
            {c.summary.slice(0, 110)}
            {c.summary.length > 110 ? "…" : ""}
          </span>
          <span className="chips">
            <span className={`chip ${c.status === "closed" ? "closed" : "open"}`}>
              {c.status === "closed" ? "Closed" : "Active"}
            </span>
            {c.crimeType ? <span className="chip">{c.crimeType}</span> : null}
            {hasCoords(c) ? <span className="chip gold">On map</span> : null}
            {ageFor && caseDateMs(c) !== null ? (
              <span className="chip">
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: "0.55rem",
                    height: "0.55rem",
                    borderRadius: "50%",
                    background: ageFor(c).color,
                    marginRight: "0.35rem",
                  }}
                />
                {ageFor(c).label}
              </span>
            ) : null}
            {c.locationText ? <span className="chip">{c.locationText}</span> : null}
          </span>
          <span
            style={{
              display: "block",
              marginTop: "0.55rem",
              fontSize: "0.84rem",
              color: "var(--faint)",
            }}
          >
            Select to preview ·{" "}
            <a
              href={`/cases/${c.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "0.84rem" }}
            >
              Open case
            </a>
          </span>
          <span className="preview-hint" aria-hidden="true">→ Preview</span>
        </button>
      ))}
    </div>
  );
}
