// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CaseDetail } from "../app/cases/[id]/case-detail";

afterEach(() => cleanup());
beforeEach(() => {
  vi.unstubAllGlobals();
});

const CASE_ID = "case-1";

const CASE_BODY = {
  id: CASE_ID,
  caseNo: "TR-0001",
  summary: "night theft incident",
  status: "open",
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  locations: [],
  persons: [],
  entries: [],
};

const RESULTS = [
  {
    caseId: "case-2",
    caseNo: "TR-0002",
    score: 9,
    reason: "same crime type and weapon",
    similarities: [
      { kind: "crime-type", description: "theft in both", strength: 9, evidence: "theft" },
    ],
  },
  {
    caseId: "case-5",
    caseNo: "TR-0005",
    score: 6,
    reason: "method overlap",
    similarities: [],
  },
  {
    caseId: "case-7",
    caseNo: "TR-0007",
    score: 3,
    reason: "weak similarity",
    similarities: [],
  },
  {
    caseId: "case-6",
    caseNo: "TR-0006",
    score: 0,
    reason: "not in model list",
    similarities: [],
  },
];

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/cases/${CASE_ID}` && !init?.method) {
      return { ok: true, status: 200, json: async () => CASE_BODY };
    }
    if (url === `/api/cases/${CASE_ID}/similar?stream=1`) {
      const lines = [
        JSON.stringify({ seq: 1, elapsedMs: 0, type: "started" }),
        JSON.stringify({
          seq: 2,
          elapsedMs: 1,
          type: "result",
          results: RESULTS,
          fresh: true,
          limit: 5,
          pendingEnrichment: false,
        }),
      ];
      return new Response(lines.join("\n") + "\n", {
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    if (url === `/api/cases/${CASE_ID}/links` && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 201,
        json: async () => ({ sourceId: CASE_ID, targetId: body.targetId }),
      };
    }
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("similar cards", () => {
  it("separates primary approve from details toggle with score band", async () => {
    const fetchMock = stubFetch();
    render(<CaseDetail caseId={CASE_ID} />);

    const list = await screen.findByRole("list", { name: /similar/i });
    const cards = screen.getAllByTestId("similar-card");
    expect(cards).toHaveLength(4);

    // Score bands: 9 -> high, 6 -> mid, 3 -> low.
    const bands = cards.map((c) => c.querySelector(".sim-score-band"));
    expect(bands[0]?.getAttribute("data-score")).toBe("high");
    expect(bands[1]?.getAttribute("data-score")).toBe("mid");
    expect(bands[2]?.getAttribute("data-score")).toBe("low");

    // Primary action language + style.
    const primary = within(cards[0]).getByRole("button", { name: "Mark relevant" });
    expect(primary.classList.contains("btn-primary")).toBe(true);

    // Secondary toggle keeps ghost style.
    const toggle = within(cards[0]).getByRole("button", { name: /show details/i });
    expect(toggle.classList.contains("btn-ghost")).toBe(true);

    // Approve flow marks the card with a gold chip.
    fireEvent.click(primary);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            url === `/api/cases/${CASE_ID}/links` &&
            (init as RequestInit)?.method === "POST",
        ),
      ).toHaveLength(1);
    });
    expect(await within(cards[0]).findByText(/✓ Approved/)).toBeTruthy();
  });

  it("zero score uses muted band", async () => {
    stubFetch();
    render(<CaseDetail caseId={CASE_ID} />);

    const cards = await screen.findAllByTestId("similar-card");
    const zeroCard = cards[3];
    const band = zeroCard.querySelector(".sim-score-band");
    expect(band?.getAttribute("data-score")).toBe("low");
    expect(band?.className).toContain("sim-score-band");

    // Mark relevant still works on the zero-score card.
    fireEvent.click(within(zeroCard).getByRole("button", { name: "Mark relevant" }));
    expect(await within(zeroCard).findByText(/✓ Approved/)).toBeTruthy();
  });
});
