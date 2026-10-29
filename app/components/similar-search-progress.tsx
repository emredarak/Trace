"use client";

import { useEffect, useRef, useState } from "react";
import type { StageKey, StageStatus } from "../../lib/search-estimate";

export interface StageView {
  key: StageKey;
  label: string;
  owner: string;
  why: string;
  status: StageStatus;
  durationMs?: number;
  activeElapsedMs?: number;
  details: string[];
  /** Chip shown next to the label, e.g. "Already done" for pre-completed work. */
  note?: string;
}

/** "muse-wonder-1.0" -> "Muse Wonder 1.0", "sam-3.1" -> "SAM 3.1". */
export function displayModelName(id: string): string {
  if (id.startsWith("muse-")) {
    return (
      "Muse " +
      id
        .slice("muse-".length)
        .split("-")
        .map((w) => (/^[0-9]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(" ")
    );
  }
  if (id.startsWith("sam-")) return `SAM ${id.slice("sam-".length)}`;
  return id;
}

const css = [
  "@keyframes ssp-pulse{0%,100%{box-shadow:0 0 0 0 rgba(242,179,61,.35)}50%{box-shadow:0 0 0 6px rgba(242,179,61,0)}}",
  ".ssp-active-dot{animation:ssp-pulse 1.8s ease-in-out infinite}",
  "@media (prefers-reduced-motion: reduce){.ssp-active-dot{animation:none}}",
].join("");

export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatStageSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  return `${m}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function marker(stage: StageView, index: number): string {
  if (stage.status === "done") return "✓";
  if (stage.status === "skipped") return "–";
  if (stage.status === "degraded") return "!";
  if (stage.status === "active") return "◌";
  return String(index + 1);
}

export function SimilarSearchProgress({
  stages,
  elapsedMs,
  estimate,
  estimateOverrun,
}: {
  stages: StageView[];
  elapsedMs: number;
  estimate: { lowMs: number; highMs: number } | null;
  estimateOverrun: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const autoOpened = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const stage of stages) {
      if (stage.status === "active" && !autoOpened.current.has(stage.key)) {
        autoOpened.current.add(stage.key);
        setExpanded((prev) => ({ ...prev, [stage.key]: true }));
      }
    }
  }, [stages]);

  const active = stages.find((s) => s.status === "active");
  const statusText = active
    ? `Finding similar cases — ${active.label}…`
    : "Finding similar cases…";
  const lowS = estimate ? Math.ceil(estimate.lowMs / 1000) : 0;
  const highS = estimate ? Math.ceil(estimate.highMs / 1000) : 0;

  return (
    <div>
      <style>{css}</style>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          alignItems: "flex-start",
          borderBottom: "1px solid var(--line-soft)",
          paddingBottom: "0.8rem",
          marginBottom: "0.4rem",
        }}
      >
        <p aria-live="polite" style={{ margin: 0, color: "var(--muted)" }}>
          {statusText}
        </p>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div
            style={{
              fontSize: "2rem",
              fontWeight: 750,
              lineHeight: 1,
              color: "var(--text)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatClock(elapsedMs)}
          </div>
          <div
            style={{
              color: "var(--faint)",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginTop: "0.25rem",
            }}
          >
            Elapsed
          </div>
          {estimateOverrun ? (
            <p
              style={{
                color: "var(--gold)",
                fontSize: "0.8rem",
                margin: "0.45rem 0 0",
                maxWidth: "16rem",
              }}
            >
              Taking longer than expected — the model is still responding
            </p>
          ) : estimate ? (
            <p
              style={{
                display: "inline-block",
                border: "1px solid var(--line)",
                borderRadius: "999px",
                padding: "0.15rem 0.6rem",
                color: "var(--gold)",
                fontSize: "0.8rem",
                margin: "0.45rem 0 0",
              }}
            >
              Estimated remaining{" "}
              {lowS === highS ? `~${lowS}s` : `~${lowS}–${highS}s`}
            </p>
          ) : null}
        </div>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {stages.map((stage, index) => {
          const isOpen = expanded[stage.key] === true;
          const detailLines =
            stage.details.length > 0
              ? stage.details
              : stage.status === "skipped"
                ? ["Skipped — nothing to do for this step."]
                : [];
          return (
            <li
              key={stage.key}
              style={{ borderBottom: "1px solid var(--line-soft)", padding: "0.55rem 0" }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [stage.key]: !isOpen }))
                }
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "flex-start",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  color: "var(--text)",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                }}
              >
                <span
                  aria-hidden
                  className={stage.status === "active" ? "ssp-active-dot" : undefined}
                  style={{
                    flex: "0 0 1.5rem",
                    height: "1.5rem",
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.8rem",
                    border: "1px solid var(--line)",
                    background:
                      stage.status === "done"
                        ? "var(--accent)"
                        : stage.status === "degraded"
                          ? "var(--gold)"
                          : "var(--panel-2)",
                    color:
                      stage.status === "done" || stage.status === "degraded"
                        ? "var(--accent-ink)"
                        : stage.status === "active"
                          ? "var(--gold)"
                          : "var(--faint)",
                  }}
                >
                  {marker(stage, index)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {index + 1} · {stage.label}
                  </strong>{" "}
                  {stage.note ? (
                    <span style={{ color: "var(--accent)", fontSize: "0.8rem", fontWeight: 650 }}>
                      {stage.note}
                    </span>
                  ) : null}
                  {stage.status === "skipped" ? (
                    <span style={{ color: "var(--faint)", fontSize: "0.8rem" }}>Skipped</span>
                  ) : null}
                  {stage.status === "degraded" ? (
                    <span style={{ color: "var(--gold)", fontSize: "0.8rem" }}>Incomplete</span>
                  ) : null}
                  <small style={{ display: "block", color: "var(--muted)", lineHeight: 1.45 }}>
                    {stage.owner} — {stage.why}
                  </small>
                </span>
                <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {stage.status === "active" && stage.activeElapsedMs !== undefined
                    ? formatStageSeconds(stage.activeElapsedMs)
                    : stage.durationMs !== undefined &&
                        (stage.status === "done" || stage.status === "degraded" || stage.status === "skipped")
                      ? formatStageSeconds(stage.durationMs)
                      : ""}
                </span>
              </button>
              {isOpen && detailLines.length > 0 ? (
                <div
                  style={{
                    margin: "0.5rem 0 0.2rem 2.1rem",
                    border: "1px solid var(--line-soft)",
                    borderRadius: "9px",
                    padding: "0.55rem 0.75rem",
                    background: "var(--panel-2)",
                  }}
                >
                  {detailLines.map((line) => (
                    <p key={line} style={{ margin: 0, fontSize: "0.88rem", color: "var(--muted)" }}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
