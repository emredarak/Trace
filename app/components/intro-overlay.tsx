"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_CLOSE_MS = 2200;
const LEAVE_MS = 400;
const LINE_MS = 600;

const LINES = ["OPENING CASE BOARD…", "LOCATING PINS…", "READY"];

function prefersReducedMotion(): boolean {
  const mm =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { matchMedia?: typeof window.matchMedia }).matchMedia === "function"
      ? (globalThis as { matchMedia: typeof window.matchMedia }).matchMedia(
          "(prefers-reduced-motion: reduce)",
        )
      : null;
  return mm?.matches === true;
}

function returnFocusToMain(): void {
  const main = document.querySelector("main");
  if (main instanceof HTMLElement) {
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
  }
}

/**
 * Intro overlay shown on every full page load: TRACE wordmark tracking-in,
 * gold sweep, mono status lines, radar ring. Auto-closes after 2200ms with
 * a 400ms leaving curtain. Skip button + Escape close early. Never renders
 * under prefers-reduced-motion.
 */
export function IntroOverlay() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const closedRef = useRef(false);
  const timersRef = useRef<number[]>([]);
  const skipRef = useRef<HTMLButtonElement | null>(null);

  const finish = useCallback(() => {
    setVisible(false);
    returnFocusToMain();
  }, []);

  const beginLeave = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setLeaving(true);
    timersRef.current.push(window.setTimeout(finish, LEAVE_MS));
  }, [finish]);

  useEffect(() => {
    setMounted(true);
    if (prefersReducedMotion()) return;
    setVisible(true);
    const timers = timersRef.current;
    timers.push(window.setTimeout(() => { if (!closedRef.current) setLineIndex(1); }, LINE_MS));
    timers.push(window.setTimeout(() => { if (!closedRef.current) setLineIndex(2); }, LINE_MS * 2));
    timers.push(window.setTimeout(beginLeave, AUTO_CLOSE_MS));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") beginLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      timers.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, [beginLeave]);

  useEffect(() => {
    if (mounted && visible) skipRef.current?.focus({ preventScroll: true });
  }, [mounted, visible]);

  if (!mounted || !visible) return null;

  return (
    <div
      data-testid="intro-overlay"
      className={leaving ? "intro-overlay is-leaving" : "intro-overlay"}
      role="dialog"
      aria-modal="true"
      aria-label="Opening case board"
    >
      <div className="intro-radar" aria-hidden="true" />
      <div className="intro-card">
        <p className="intro-wordmark">
          TRACE<em>.</em>
        </p>
        <div className="intro-rule" aria-hidden="true" />
        <p className="intro-mono" aria-live="polite">
          {LINES[lineIndex]}
        </p>
        <button
          type="button"
          data-testid="intro-skip"
          className="intro-skip"
          onClick={beginLeave}
          ref={skipRef}
          autoFocus
        >
          Skip
        </button>
      </div>
    </div>
  );
}

export default IntroOverlay;
