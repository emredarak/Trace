// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { CaseDetail } from "../app/cases/[id]/page";

afterEach(() => cleanup());

beforeEach(() => {
  vi.unstubAllGlobals();
});

const CASE_ID = "vaka-1";

const CASE_ITEM = {
  id: CASE_ID,
  caseNo: "TR-0001",
  summary: "gece hırsızlık olayı",
  crimeType: "hırsızlık",
  locationType: "sokak",
  weapon: "bıçak",
  mo: "gece yaklaşma",
  needsRerank: false,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  entries: [
    {
      id: "e1",
      caseId: CASE_ID,
      type: "note",
      note: "kısa not",
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "e2",
      caseId: CASE_ID,
      type: "transcript",
      note: "konuşmacı 1: gece gördüm",
      createdAt: "2026-10-26T00:02:00.000Z",
    },
    {
      id: "e3",
      caseId: CASE_ID,
      type: "photo-marking",
      note: JSON.stringify({
        hint: "bıçak",
        boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: "bıçak" }],
      }),
      createdAt: "2026-10-26T00:03:00.000Z",
    },
  ],
};

const RESULTS = [
  {
    caseId: "vaka-2",
    score: 9,
    reason: "aynı suç türü ve silah",
    quote: "gece bıçaklı hırsızlık",
    matchedFields: ["crimeType", "weapon"],
  },
  {
    caseId: "vaka-3",
    score: 7,
    reason: "benzer yöntem",
    quote: "gece yaklaşma ile gasp",
    matchedFields: ["mo"],
  },
  {
    caseId: "vaka-4",
    score: 5,
    reason: "konum türü uyuyor",
    quote: "sokakta yankesicilik",
    matchedFields: ["locationType"],
  },
  {
    caseId: "vaka-5",
    score: 3,
    reason: "zayıf benzerlik",
    quote: "gündüz hırsızlık",
    matchedFields: [],
  },
  {
    caseId: "vaka-6",
    score: 0,
    reason: "model listesinde yok",
    quote: "alakasız kayıt",
    matchedFields: [],
  },
];

function stubFetch(fresh = false) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cases") {
      return { ok: true, status: 200, json: async () => [CASE_ITEM] };
    }
    if (url === `/api/cases/${CASE_ID}/similar`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: RESULTS, fresh }),
      };
    }
    if (url === `/api/cases/${CASE_ID}/links` && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 201,
        json: async () => ({ sourceId: CASE_ID, targetId: body.targetId }),
      };
    }
    throw new Error(`beklenmeyen istek: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderPage() {
  render(<CaseDetail caseId={CASE_ID} />);
}

describe("Vaka detay + benzer liste", () => {
  it("sahte 5 sonuç listelenir, her maddede skor ve gerekçe görünür", async () => {
    stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /benzer/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);

    for (const r of RESULTS) {
      expect(
        within(list).getByText(r.reason),
      ).toBeTruthy();
      const item = within(list).getByText(r.reason).closest("li");
      expect(item).toBeTruthy();
      expect(within(item as HTMLElement).getByText(new RegExp(`${r.score}`))).toBeTruthy();
    }
  });

  it("vaka detayı ve deliller (transcript + foto işareti) görünür", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("gece hırsızlık olayı")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: /TR-0001/ })).toBeTruthy();
    expect(
      await screen.findByText("konuşmacı 1: gece gördüm"),
    ).toBeTruthy();
    const detail = await screen.findByRole("region", { name: "Vaka detayı" });
    expect(within(detail).getAllByText(/bıçak/).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/1.*kutu/)).toBeTruthy();
  });

  it("fresh false ise 'yeni benzerler' rozeti görünür", async () => {
    stubFetch(false);
    renderPage();

    expect(await screen.findByText(/yeni benzerler/i)).toBeTruthy();
  });

  it("'alakalı' düğmesi links POST çağrısı yapar ve onayı gösterir", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /benzer/i });
    const buttons = within(list).getAllByRole("button", { name: /alakalı/i });
    expect(buttons).toHaveLength(5);

    fireEvent.click(buttons[0]);

    await waitFor(() => {
      const linkCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === `/api/cases/${CASE_ID}/links` &&
          (init as RequestInit)?.method === "POST",
      );
      expect(linkCalls).toHaveLength(1);
    });
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => url === `/api/cases/${CASE_ID}/links`,
    ) as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      targetId: "vaka-2",
    });
    expect(await within(list).findByText(/onaylandı/i)).toBeTruthy();
  });
});
