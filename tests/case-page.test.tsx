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
  officer: "Eski Memur Adı",
  victimAge: 99,
  victimGender: "eski-cinsiyet",
  suspects: "Eski Şüpheli Metni",
  witnesses: "Eski Tanık Metni",
  persons: [
    {
      id: "kisi-1",
      caseId: CASE_ID,
      name: "Ayşe Yılmaz",
      age: 34,
      gender: "kadın",
      note: "maktul notu",
      type: "maktul",
      relatedVictimId: null,
      relationship: null,
      unidentified: false,
      contactStatus: "ulasildi",
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "kisi-2",
      caseId: CASE_ID,
      name: "Mehmet Demir",
      age: 40,
      gender: "erkek",
      note: "şüpheli notu",
      type: "supheli",
      relatedVictimId: "kisi-1",
      relationship: "eşi",
      unidentified: false,
      contactStatus: "ulasilamadi",
      createdAt: "2026-10-26T00:02:00.000Z",
    },
    {
      id: "kisi-3",
      caseId: CASE_ID,
      name: null,
      age: null,
      gender: null,
      note: "tanık notu",
      type: "tanik",
      relatedVictimId: "kisi-1",
      relationship: "komşusu",
      unidentified: true,
      contactStatus: null,
      createdAt: "2026-10-26T00:03:00.000Z",
    },
  ],
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
    caseNo: "TR-0002",
    score: 9,
    reason: "aynı suç türü ve silah",
    similarities: [
      { kind: "suc-tipi", description: "ikisi de hırsızlık", strength: 9, evidence: "hırsızlık" },
      { kind: "silah", description: "ikisinde de bıçak", strength: 8, evidence: "bıçak" },
    ],
  },
  {
    caseId: "vaka-3",
    caseNo: "TR-0003",
    score: 7,
    reason: "benzer yöntem",
    similarities: [
      { kind: "yontem", description: "gece yaklaşma yöntemi ortak", strength: 7, evidence: "gece yaklaşma" },
    ],
  },
  {
    caseId: "vaka-4",
    caseNo: "TR-0004",
    score: 5,
    reason: "konum türü uyuyor",
    similarities: [
      { kind: "konum", description: "sokak konumu ortak", strength: 5, evidence: "sokak" },
    ],
  },
  {
    caseId: "vaka-5",
    caseNo: "TR-0005",
    score: 3,
    reason: "zayıf benzerlik",
    similarities: [],
  },
  {
    caseId: "vaka-6",
    caseNo: "TR-0006",
    score: 0,
    reason: "model listesinde yok",
    similarities: [],
  },
];

function stubFetch(
  fresh = false,
  opts: {
    status?: string;
    locations?: unknown[];
    persons?: unknown[];
    queued?: boolean;
    failLocationSave?: boolean;
    failPersonSave?: boolean;
    pendingEnrichment?: boolean;
  } = {},
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const caseBody = {
    ...CASE_ITEM,
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.locations ? { locations: opts.locations } : {}),
    ...(opts.persons ? { persons: opts.persons } : {}),
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === `/api/cases/${CASE_ID}` && !init?.method) {
      return { ok: true, status: 200, json: async () => caseBody };
    }
    if (url === `/api/cases/${CASE_ID}` && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...caseBody, status: body.status }),
      };
    }
    if (
      url === `/api/cases/${CASE_ID}/locations` &&
      init?.method === "POST"
    ) {
      if (opts.failLocationSave) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "sunucu hatası" }),
        };
      }
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
    if (url === `/api/cases/${CASE_ID}/persons` && init?.method === "POST") {
      if (opts.failPersonSave) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "sunucu hatası" }),
        };
      }
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
          id: "kisi-yeni",
          caseId: CASE_ID,
          ...body,
          createdAt: "2026-10-26T00:04:00.000Z",
        }),
      };
    }
    if (
      url.startsWith(`/api/cases/${CASE_ID}/persons/`) &&
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
      url.startsWith(`/api/cases/${CASE_ID}/persons/`) &&
      init?.method === "DELETE"
    ) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url === `/api/cases/${CASE_ID}/evidences` && init?.method === "POST") {
      const form = init.body as FormData;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: "delil-yeni",
          caseId: CASE_ID,
          type: "evidence",
          title: form.get("title"),
          note: form.get("note") || null,
          imageFile: null,
          audioFile: null,
          createdAt: "2026-10-26T00:04:00.000Z",
        }),
      };
    }
    if (
      url.startsWith(`/api/cases/${CASE_ID}/evidences/`) &&
      init?.method === "PATCH"
    ) {
      const form = init.body as FormData;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: url.split("/").pop(),
          caseId: CASE_ID,
          type: "evidence",
          title: form.get("title"),
          note: form.get("note") || null,
          imageFile: null,
          audioFile: null,
        }),
      };
    }
    if (
      url.startsWith(`/api/cases/${CASE_ID}/evidences/`) &&
      init?.method === "DELETE"
    ) {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    if (url === `/api/cases/${CASE_ID}/similar`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: RESULTS, fresh, limit: 5, pendingEnrichment: opts.pendingEnrichment ?? false }),
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
    // Üst düzey sonuç kartları (iç benzerlik maddeleri hariç).
    expect(list.children).toHaveLength(5);

    for (const r of RESULTS) {
      expect(
        within(list).getByText(r.reason),
      ).toBeTruthy();
      const item = within(list).getByText(r.reason).closest("li");
      expect(item).toBeTruthy();
      expect((item as HTMLElement).textContent).toContain(String(r.score));
    }
  });

  it("kartta ham id yerine vaka numarası bağlantısı ve benzerlik maddeleri görünür", async () => {
    stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /benzer/i });
    for (const r of RESULTS) {
      const link = within(list).getByRole("link", { name: new RegExp(r.caseNo) });
      expect(link.getAttribute("href")).toBe(`/cases/${r.caseId}`);
      expect(link.textContent).not.toContain(r.caseId);
    }
    const first = within(list).getByText(RESULTS[0].reason).closest("li") as HTMLElement;
    expect(within(first).getByText(/suc-tipi/)).toBeTruthy();
    expect(first.textContent).toContain("ikisi de hırsızlık");
    expect(first.textContent).toContain("9/10");
    expect(within(first).getByText(/^silah:/)).toBeTruthy();
    expect(first.textContent).toContain("ikisinde de bıçak");
    expect(first.textContent).toContain("8/10");
  });

  it("bekleyen zenginleştirme varsa bilgi notu görünür", async () => {
    stubFetch(false, { pendingEnrichment: true });
    renderPage();

    const section = await screen.findByRole("region", { name: /benzer vakalar/i });
    expect(await within(section).findByText(/bekleyen zenginleştirme|zenginleştirme.*bekliyor/i)).toBeTruthy();
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

describe("Vaka detayı Deliller bölümü", () => {
  it("Vakayı Düzenle bağlantısı yoktur", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText("gece hırsızlık olayı")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /vakayı düzenle/i })).toBeNull();
    expect(document.querySelector('a[href$="/edit"]')).toBeNull();
  });

  it("taslak delil Kaydet olmadan gitmez; Kaydet multipart POST yapar", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Deliller" });
    const section = heading.closest("section") as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: "+ Delil Ekle" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/başlı/i), {
      target: { value: "Yeni delil" },
    });
    fireEvent.change(within(dialog).getByLabelText(/not/i), {
      target: { value: "delil notu" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delili Kullan" }));
    expect(await within(section).findByText("Yeni delil")).toBeTruthy();

    const postsBefore = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/cases/${CASE_ID}/evidences` &&
        (init as RequestInit)?.method === "POST",
    );
    expect(postsBefore).toHaveLength(0);

    fireEvent.click(within(section).getByRole("button", { name: "Kaydet" }));
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === `/api/cases/${CASE_ID}/evidences` &&
          (init as RequestInit)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
      const body = (posts[0][1] as RequestInit).body as FormData;
      expect(body.get("title")).toBe("Yeni delil");
      expect(body.get("note")).toBe("delil notu");
    });
    expect(await within(section).findByText(/Deliller kaydedildi/)).toBeTruthy();
  });

  it("kapalı vakada delil kontrolleri yoktur", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();
    const heading = await screen.findByRole("heading", { name: "Deliller" });
    const section = heading.closest("section") as HTMLElement;
    expect(
      within(section).queryByRole("button", { name: "+ Delil Ekle" }),
    ).toBeNull();
    expect(
      within(section).queryByRole("button", { name: "Düzenle" }),
    ).toBeNull();
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

  it("(g) kirli taslakla vaka kapatılınca Kaydet/Vazgeç ve konum kontrolleri kalkar", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Kapanış taslağı");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vazgeç" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Vakayı Kapat" }));

    expect(
      await screen.findByRole("button", { name: "Vakayı Aç" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vazgeç" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "+ Konum Ekle" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Düzenle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sil" })).toBeNull();
    // Kaydedilmemiş taslak satır da ortadan kalkar (tabana dönülür).
    expect(screen.queryByText("Kapanış taslağı")).toBeNull();
    expect(screen.getByText("Merdiven girişi")).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(locationCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(locationCalls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("(j) çevrimdışı (202) eklenen konum düzenlenince PATCH aynı istemci id'sine gider", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();
    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Çevrimdışı nokta");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText(/Kuyruğa alındı/)).toBeTruthy();
    const posts = locationCalls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    const postedId = (JSON.parse(posts[0][1].body as string) as { id: string }).id;
    expect(typeof postedId).toBe("string");
    expect(postedId.length).toBeGreaterThan(0);

    const item = (await screen.findByText("Çevrimdışı nokta")).closest("li");
    fireEvent.click(
      within(item as HTMLElement).getByRole("button", { name: "Düzenle" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/konum başlığı/i), {
      target: { value: "Çevrimdışı nokta güncel" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => {
      expect(locationCalls(fetchMock, "PATCH")).toHaveLength(1);
    });
    const [patchUrl] = locationCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/locations/${postedId}`);
  });

  it("(h) Kaydet hata verirse taslak satır ve Kaydet düğmesi korunur", async () => {
    const { fetchMock } = stubFetch(false, { failLocationSave: true });
    renderPage();

    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Hata taslağı");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    expect(
      await screen.findByText(/Konumlar kaydedilemedi/),
    ).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    // Taslak silinmedi, kullanıcı tekrar deneyebilir.
    expect(screen.getByText("Hata taslağı")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Vazgeç" })).toBeTruthy();
  });

  it("(i) Kaydet'e çift tıklama yinelenen POST yapmaz", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Merdiven girişi");
    await addDraftLocation("Tek kayıt");
    const saveButton = screen.getByRole("button", { name: "Kaydet" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    });
    expect(await screen.findByText(/Konumlar kaydedildi/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    });
  });
});

function personCalls(
  fetchMock: ReturnType<typeof stubFetch>["fetchMock"],
  method: string,
) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      typeof url === "string" &&
      url.includes(`/api/cases/${CASE_ID}/persons`) &&
      (init as RequestInit | undefined)?.method === method,
  ) as [string, RequestInit][];
}

async function peopleSectionEl() {
  const heading = await screen.findByRole("heading", { name: "Kişiler" });
  return heading.closest("section") as HTMLElement;
}

async function addDraftPerson(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Kişi Ekle" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/ad soyad/i), {
    target: { value: name },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Kişiyi Kullan" }),
  );
}

describe("Vaka detayı Kişiler bölümü", () => {
  it("(a) eski kişi satırları yok; ad+tür rozeti+ilişki+etiketler görünür", async () => {
    stubFetch();
    renderPage();

    const detail = await screen.findByRole("region", { name: "Vaka detayı" });
    const people = await peopleSectionEl();
    expect(await within(people).findByText("Ayşe Yılmaz")).toBeTruthy();
    expect(within(people).getByText("Maktül")).toBeTruthy();
    expect(within(people).getByText("Mehmet Demir")).toBeTruthy();
    expect(within(people).getByText("Şüpheli")).toBeTruthy();
    expect(within(people).getByText("Tanık")).toBeTruthy();
    expect(within(people).getByText(/İlişkili Maktül: Ayşe Yılmaz \(eşi\)/)).toBeTruthy();
    expect(within(people).getByText(/İlişkili Maktül: Ayşe Yılmaz \(komşusu\)/)).toBeTruthy();
    expect(within(people).getByText("Kimliği Tespit Edilemedi")).toBeTruthy();
    expect(within(people).getByText("Ulaşıldı")).toBeTruthy();
    expect(within(people).getByText("Ulaşılamadı")).toBeTruthy();
    expect(within(people).getByText("maktul notu")).toBeTruthy();
    // Eski tekil kişi satırları ve değerleri gösterilmez.
    expect(within(detail).queryByText(/Memur:/)).toBeNull();
    expect(within(detail).queryByText(/Maktul yaşı:/)).toBeNull();
    expect(within(detail).queryByText(/Maktul cinsiyeti:/)).toBeNull();
    expect(within(detail).queryByText(/Şüpheliler:/)).toBeNull();
    expect(within(detail).queryByText(/Tanıklar:/)).toBeNull();
    expect(within(detail).queryByText("Eski Memur Adı")).toBeNull();
    expect(within(detail).queryByText("Eski Şüpheli Metni")).toBeNull();
    expect(within(detail).queryByText("Eski Tanık Metni")).toBeNull();
  });

  it("(b) taslak kişi Kaydet olmadan POST yapmaz; Vazgeç satırı kaldırır", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Yeni Kişi");

    expect(await within(people).findByText("Yeni Kişi")).toBeTruthy();
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.click(
      within(people).getByRole("button", { name: "Vazgeç" }),
    );

    await waitFor(() => {
      expect(within(people).queryByText("Yeni Kişi")).toBeNull();
    });
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(within(people).getByText("Ayşe Yılmaz")).toBeTruthy();
  });

  it("(c) Kaydet POST/PATCH/DELETE farkını uygular", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Yeni Kişi");

    const editItem = (await within(people).findByText("Mehmet Demir")).closest("li");
    fireEvent.click(
      within(editItem as HTMLElement).getByRole("button", { name: "Düzenle" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/ad soyad/i), {
      target: { value: "Mehmet Demir güncel" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    expect(await within(people).findByText("Mehmet Demir güncel")).toBeTruthy();

    const deleteItem = within(people).getByText("tanık notu").closest("li");
    fireEvent.click(
      within(deleteItem as HTMLElement).getByRole("button", { name: "Sil" }),
    );
    await waitFor(() => {
      expect(within(people).queryByText("tanık notu")).toBeNull();
    });
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(personCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(personCalls(fetchMock, "DELETE")).toHaveLength(0);

    fireEvent.click(within(people).getByRole("button", { name: "Kaydet" }));

    await waitFor(() => {
      expect(personCalls(fetchMock, "POST")).toHaveLength(1);
      expect(personCalls(fetchMock, "PATCH")).toHaveLength(1);
      expect(personCalls(fetchMock, "DELETE")).toHaveLength(1);
    });
    const [, postInit] = personCalls(fetchMock, "POST")[0];
    expect(JSON.parse(postInit.body as string)).toMatchObject({
      name: "Yeni Kişi",
      type: "maktul",
    });
    const [patchUrl, patchInit] = personCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/persons/kisi-2`);
    expect(JSON.parse(patchInit.body as string)).toMatchObject({
      name: "Mehmet Demir güncel",
    });
    const [deleteUrl] = personCalls(fetchMock, "DELETE")[0];
    expect(deleteUrl).toBe(`/api/cases/${CASE_ID}/persons/kisi-3`);

    await waitFor(() => {
      expect(
        within(people).queryByRole("button", { name: "Kaydet" }),
      ).toBeNull();
    });
    expect(within(people).getByText("Yeni Kişi")).toBeTruthy();
    expect(within(people).getByText("Mehmet Demir güncel")).toBeTruthy();
  });

  it("(d) kapalı vakada kişi kontrolleri yoktur", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();

    const people = await peopleSectionEl();
    expect(await within(people).findByText("Ayşe Yılmaz")).toBeTruthy();
    expect(
      within(people).queryByRole("button", { name: "+ Kişi Ekle" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Düzenle" }),
    ).toBeNull();
    expect(within(people).queryByRole("button", { name: "Sil" })).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Kaydet" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Vazgeç" }),
    ).toBeNull();
  });

  it("(e) kirli kişi taslağıyla kapatınca taslak satır kaybolur", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Kapanış Kişisi");
    expect(
      within(people).getByRole("button", { name: "Kaydet" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Vakayı Kapat" }));

    expect(
      await screen.findByRole("button", { name: "Vakayı Aç" }),
    ).toBeTruthy();
    expect(within(people).queryByText("Kapanış Kişisi")).toBeNull();
    expect(within(people).getByText("Ayşe Yılmaz")).toBeTruthy();
    expect(
      within(people).queryByRole("button", { name: "Kaydet" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "+ Kişi Ekle" }),
    ).toBeNull();
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(personCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(personCalls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("(g) 202 kuyruk yanıtında 'Kuyruğa alındı' gösterilir, 'Kişiler kaydedildi.' gösterilmez; çift tık POST'u yinelemez", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Kuyruk Kişisi");
    const saveButton = within(people).getByRole("button", { name: "Kaydet" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(await within(people).findByText(/Kuyruğa alındı/)).toBeTruthy();
    expect(within(people).queryByText(/Kişiler kaydedildi\./)).toBeNull();
    expect(personCalls(fetchMock, "POST")).toHaveLength(1);
    await waitFor(() => {
      expect(
        within(people).queryByRole("button", { name: "Kaydet" }),
      ).toBeNull();
    });
  });

  it("(f) Kaydet hatasında taslak korunur", async () => {
    const { fetchMock } = stubFetch(false, { failPersonSave: true });
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Hata Kişisi");
    fireEvent.click(within(people).getByRole("button", { name: "Kaydet" }));

    expect(
      await within(people).findByText(/Kişiler kaydedilemedi/),
    ).toBeTruthy();
    expect(personCalls(fetchMock, "POST")).toHaveLength(1);
    expect(within(people).getByText("Hata Kişisi")).toBeTruthy();
    expect(
      within(people).getByRole("button", { name: "Kaydet" }),
    ).toBeTruthy();
    expect(
      within(people).getByRole("button", { name: "Vazgeç" }),
    ).toBeTruthy();
  });
});
