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
import { CaseDetail } from "../app/cases/[id]/case-detail";

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
  locations: [
    {
      id: "loc-1",
      caseId: CASE_ID,
      title: "Merdiven girişi",
      note: "kamera kör noktası",
      locationText: "kamera kör noktası",
      kind: "olay-yeri",
      priority: null,
      latitude: 41.015,
      longitude: 28.97,
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "loc-2",
      caseId: CASE_ID,
      title: "Arka sokak",
      note: "kaçış yönü",
      locationText: "kaçış yönü",
      kind: "iliskili",
      priority: "kritik",
      latitude: 41.02,
      longitude: 28.98,
      createdAt: "2026-10-26T00:02:00.000Z",
    },
  ],
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

function stubFetch(
  fresh = false,
  opts: { status?: string; locations?: unknown[]; queued?: boolean } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const caseBody = {
    ...CASE_ITEM,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.locations ? { locations: opts.locations } : {}),
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === `/api/cases/${CASE_ID}` && !init?.method) {
      return { ok: true, status: 200, json: async () => caseBody };
    }
    if (
      url === `/api/cases/${CASE_ID}/locations` &&
      init?.method === "POST"
    ) {
      if (opts.queued) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ queued: true }),
        };
      }
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: "loc-yeni",
          caseId: CASE_ID,
          ...body,
          createdAt: "2026-10-26T00:03:00.000Z",
        }),
      };
    }
    if (
      url.startsWith(`/api/cases/${CASE_ID}/locations/`) &&
      init?.method === "PATCH"
    ) {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: url.split("/").pop(),
          caseId: CASE_ID,
          ...body,
        }),
      };
    }
    if (
      url.startsWith(`/api/cases/${CASE_ID}/locations/`) &&
      init?.method === "DELETE"
    ) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
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

function locationCalls(
  fetchMock: ReturnType<typeof stubFetch>["fetchMock"],
  method: string,
) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      typeof url === "string" &&
      url.includes(`/api/cases/${CASE_ID}/locations`) &&
      (init as RequestInit | undefined)?.method === method,
  ) as [string, RequestInit][];
}

async function addDraftLocation(title: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Konum Ekle" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/konum başlığı/i), {
    target: { value: title },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Bu Konumu Kullan" }),
  );
}

describe("Vaka detayı Konumlar bölümü", () => {
  it("(a) eski Konum tipi satırı yok; başlık+not+etiket görünür", async () => {
    stubFetch();
    renderPage();

    const detail = await screen.findByRole("region", { name: "Vaka detayı" });
    expect(await within(detail).findByText("Merdiven girişi")).toBeTruthy();
    expect(within(detail).queryByText(/Konum tipi/)).toBeNull();
    expect(within(detail).getByText("kamera kör noktası")).toBeTruthy();
    expect(within(detail).getByText("Olay Yeri")).toBeTruthy();
    expect(within(detail).getByText("Arka sokak")).toBeTruthy();
    expect(within(detail).getByText("kaçış yönü")).toBeTruthy();
    expect(within(detail).getByText("Kritik")).toBeTruthy();
    // Olay Yeri varken uyarı bandı yoktur.
    expect(
      within(detail).queryByText(
        /Olay Yeri olarak işaretlenmiş konum yok/,
      ),
    ).toBeNull();
  });

  it("(b) taslak satır Kaydet olmadan POST yapmaz; Vazgeç satırı kaldırır", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Yeni nokta");

    expect(await screen.findByText("Yeni nokta")).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));

    await waitFor(() => {
      expect(screen.queryByText("Yeni nokta")).toBeNull();
    });
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(screen.getByText("Merdiven girişi")).toBeTruthy();
  });

  it("(c) Kaydet POST/PATCH/DELETE farkını uygular ve kalıcı hâli gösterir", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Arka sokak");
    await addDraftLocation("Yeni nokta");

    // Mevcut konumu düzenle (taslak).
    const editItem = (await screen.findByText("Arka sokak")).closest("li");
    fireEvent.click(
      within(editItem as HTMLElement).getByRole("button", { name: "Düzenle" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/konum başlığı/i), {
      target: { value: "Arka sokak güncel" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText("Arka sokak güncel")).toBeTruthy();

    // İlk konumu sil (taslak).
    const deleteItem = screen.getByText("Merdiven girişi").closest("li");
    fireEvent.click(
      within(deleteItem as HTMLElement).getByRole("button", { name: "Sil" }),
    );
    await waitFor(() => {
      expect(screen.queryByText("Merdiven girişi")).toBeNull();
    });
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(locationCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(locationCalls(fetchMock, "DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
      expect(locationCalls(fetchMock, "PATCH")).toHaveLength(1);
      expect(locationCalls(fetchMock, "DELETE")).toHaveLength(1);
    });
    const [, postInit] = locationCalls(fetchMock, "POST")[0];
    expect(JSON.parse(postInit.body as string)).toMatchObject({
      title: "Yeni nokta",
    });
    const [patchUrl, patchInit] = locationCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/locations/loc-2`);
    expect(JSON.parse(patchInit.body as string)).toMatchObject({
      title: "Arka sokak güncel",
    });
    const [deleteUrl] = locationCalls(fetchMock, "DELETE")[0];
    expect(deleteUrl).toBe(`/api/cases/${CASE_ID}/locations/loc-1`);

    // Kaydet sonrası Kaydet/Vazgeç kalkar, kalıcı liste kalır.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Vazgeç" })).toBeNull();
    });
    expect(screen.getByText("Yeni nokta")).toBeTruthy();
    expect(screen.getByText("Arka sokak güncel")).toBeTruthy();
  });

  it("(d) kapalı vakada ekle/düzenle/sil düğmeleri yoktur", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();

    expect(await screen.findByText("Merdiven girişi")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "+ Konum Ekle" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sil" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
  });

  it("(e) Olay Yeri olmayan listede uyarı bandı görünür", async () => {
    stubFetch(false, {
      locations: [
        {
          id: "loc-2",
          caseId: CASE_ID,
          title: "Arka sokak",
          note: "kaçış yönü",
          kind: "iliskili",
          priority: "kritik",
          createdAt: "2026-10-26T00:02:00.000Z",
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByText(/Olay Yeri olarak işaretlenmiş konum yok/),
    ).toBeTruthy();
  });

  it("(f) 202 kuyruk yanıtında 'Kuyruğa alındı' gösterilir ve taslak kalıcı sayılır", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();

    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Kuyruk noktası");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(await screen.findByText(/Kuyruğa alındı/)).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    });
    expect(screen.getByText("Kuyruk noktası")).toBeTruthy();
  });
});
