import type { CaseRecord } from "./case-schema";

/**
 * Case date used for map colouring: incident date first; if it is missing
 * or not a parseable date (some records carry free text there), fall back
 * to the record (case opened) date.
 */
export function caseDateMs(
  c: Pick<CaseRecord, "occurredAt" | "createdAt">,
): number | null {
  for (const raw of [c.occurredAt, c.createdAt]) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function ageInDays(
  c: Pick<CaseRecord, "occurredAt" | "createdAt">,
  nowMs: number,
): number | null {
  const ms = caseDateMs(c);
  if (ms === null) return null;
  return Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
}

/** t=0 is the newest case on the map, t=1 the oldest: green → gold → red. */
export function ageColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const hue =
    clamped < 0.5
      ? 150 - (clamped / 0.5) * (150 - 45)
      : 45 - ((clamped - 0.5) / 0.5) * (45 - 8);
  return `hsl(${Math.round(hue)} 78% 52%)`;
}

export function ageLabel(days: number | null): string {
  if (days === null) return "No date";
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months <= 1 ? "1 month ago" : `${months} months ago`;
  }
  const years = Math.floor(days / 365);
  return years <= 1 ? "1 year ago" : `${years} years ago`;
}
