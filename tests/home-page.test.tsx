// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "../app/page";
import { ageColor, ageLabel, caseDateMs } from "../lib/case-age";

afterEach(() => cleanup());

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Home page case lists", () => {
  it("shows open and closed cases in separate sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: "a", caseNo: "TR-0001", summary: "open job", status: "open" },
          { id: "b", caseNo: "TR-0002", summary: "closed job", status: "closed" },
        ],
      }),
    );
    render(<Home />);

    expect(await screen.findByText(/Active Cases \(1\)/)).toBeTruthy();
    expect(await screen.findByText(/Past Cases \(1\)/)).toBeTruthy();
    // The selected case also appears in the detail preview panel.
    expect(screen.getAllByText(/TR-0001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TR-0002/).length).toBeGreaterThan(0);
  });

  it("map age scale goes green (newest) to red (oldest) with readable labels", () => {
    expect(ageColor(0)).toContain("150");
    expect(ageColor(1)).toContain("8 78%");
    expect(ageColor(0)).not.toBe(ageColor(1));
    expect(ageLabel(0)).toBe("Today");
    expect(ageLabel(10)).toBe("10 days ago");
    expect(ageLabel(75)).toBe("2 months ago");
    // Free-text incident fields fall back to the record date; only a case
    // with no parseable date at all stays dateless (grey on the map).
    expect(
      caseDateMs({
        occurredAt: "In the morning at the market, a wallet was lifted.",
        createdAt: "2026-10-28T15:19:30.681Z",
      }),
    ).toBe(Date.parse("2026-10-28T15:19:30.681Z"));
    expect(caseDateMs({ occurredAt: "no date here", createdAt: "" })).toBeNull();
  });

  it("shows warning on server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    render(<Home />);

    expect(await screen.findByText(/could not load cases/i)).toBeTruthy();
  });
});
