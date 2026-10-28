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

const CASE_ID = "case-1";

const CASE_ITEM = {
  id: CASE_ID,
  caseNo: "TR-0001",
  summary: "night theft incident",
  crimeType: "theft",
  locationType: "street",
  weapon: "knife",
  mo: "night approach",
  needsRerank: false,
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
  officer: "Former Officer Name",
  victimAge: 99,
  victimGender: "former-gender",
  suspects: "Former Suspect Text",
  witnesses: "Former Witness Text",
  persons: [
    {
      id: "kisi-1",
      caseId: CASE_ID,
      name: "Alice Johnson",
      age: 34,
      gender: "female",
      note: "victim note",
      type: "victim",
      relatedVictimId: null,
      relationship: null,
      unidentified: false,
      contactStatus: "reached",
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "kisi-2",
      caseId: CASE_ID,
      name: "Brian Carter",
      age: 40,
      gender: "male",
      note: "suspect note",
      type: "suspect",
      relatedVictimId: "kisi-1",
      relationship: "spouse",
      unidentified: false,
      contactStatus: "unreached",
      createdAt: "2026-10-26T00:02:00.000Z",
    },
    {
      id: "kisi-3",
      caseId: CASE_ID,
      name: null,
      age: null,
      gender: null,
      note: "witness note",
      type: "witness",
      relatedVictimId: "kisi-1",
      relationship: "neighbor",
      unidentified: true,
      contactStatus: null,
      createdAt: "2026-10-26T00:03:00.000Z",
    },
  ],
  locations: [
    {
      id: "loc-1",
      caseId: CASE_ID,
      title: "Stairwell entrance",
      note: "camera blind spot",
      locationText: "camera blind spot",
      kind: "crime-scene",
      priority: null,
      latitude: 41.015,
      longitude: 28.97,
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "loc-2",
      caseId: CASE_ID,
      title: "Back street",
      note: "escape route",
      locationText: "escape route",
      kind: "related",
      priority: "critical",
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
      note: "short note",
      createdAt: "2026-10-26T00:01:00.000Z",
    },
    {
      id: "e2",
      caseId: CASE_ID,
      type: "transcript",
      note: "speaker 1: I saw it at night",
      createdAt: "2026-10-26T00:02:00.000Z",
    },
    {
      id: "e3",
      caseId: CASE_ID,
      type: "photo-marking",
      note: JSON.stringify({
        hint: "knife",
        boxes: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, label: "knife" }],
      }),
      createdAt: "2026-10-26T00:03:00.000Z",
    },
  ],
};

const RESULTS = [
  {
    caseId: "case-2",
    caseNo: "TR-0002",
    score: 9,
    reason: "same crime type and weapon",
    similarities: [
      { kind: "crime-type", description: "theft in both", strength: 9, evidence: "theft" },
      { kind: "weapon", description: "knife in both", strength: 8, evidence: "knife" },
    ],
  },
  {
    caseId: "case-3",
    caseNo: "TR-0003",
    score: 7,
    reason: "similar method",
    similarities: [
      { kind: "method", description: "night approach in common", strength: 7, evidence: "night approach" },
    ],
  },
  {
    caseId: "case-4",
    caseNo: "TR-0004",
    score: 5,
    reason: "location type matches",
    similarities: [
      { kind: "location", description: "street location in common", strength: 5, evidence: "street" },
    ],
  },
  {
    caseId: "case-5",
    caseNo: "TR-0005",
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
          json: async () => ({ error: "server error" }),
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
          json: async () => ({ error: "server error" }),
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
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderPage() {
  render(<CaseDetail caseId={CASE_ID} />);
}

describe("Case detail + similar list", () => {
  it("lists 5 fake results, each item shows score and reason", async () => {
    stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /similar/i });
    // Top-level result cards (excluding inner similarity items).
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

  it("similar details stay collapsed until expanded, expand/collapse all works", async () => {
    stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /similar/i });
    const first = within(list).getByText(RESULTS[0].reason).closest("li") as HTMLElement;
    expect(within(first).queryByText(/^Crime Type:/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(within(first).getByText(/^Crime Type:/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(within(first).queryByText(/^Crime Type:/)).toBeNull();
  });

  it("card shows case-number link instead of raw id plus similarity items", async () => {
    stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /similar/i });
    for (const r of RESULTS) {
      const link = within(list).getByRole("link", { name: new RegExp(r.caseNo) });
      expect(link.getAttribute("href")).toBe(`/cases/${r.caseId}`);
      expect(link.textContent).not.toContain(r.caseId);
    }
    const first = within(list).getByText(RESULTS[0].reason).closest("li") as HTMLElement;
    fireEvent.click(within(first).getByRole("button", { name: /show details/i }));
    expect(within(first).getByText(/^Crime Type:/)).toBeTruthy();
    expect(within(first).queryByText(/crime-type/)).toBeNull();
    expect(first.textContent).toContain("theft in both");
    expect(first.textContent).toContain("9/10");
    expect(within(first).getByText(/^Weapon:/)).toBeTruthy();
    const third = within(list).getByText(RESULTS[1].reason).closest("li") as HTMLElement;
    fireEvent.click(within(third).getByRole("button", { name: /show details/i }));
    expect(within(third).getByText(/^Method:/)).toBeTruthy();
    const fourth = within(list).getByText(RESULTS[2].reason).closest("li") as HTMLElement;
    fireEvent.click(within(fourth).getByRole("button", { name: /show details/i }));
    expect(within(fourth).getByText(/^Location:/)).toBeTruthy();
    expect(first.textContent).toContain("knife in both");
    expect(first.textContent).toContain("8/10");
  });

  it("shows an info note when enrichment is pending", async () => {
    stubFetch(false, { pendingEnrichment: true });
    renderPage();

    const section = await screen.findByRole("region", { name: /similar cases/i });
    expect(await within(section).findByText(/pending|background enrichment/i)).toBeTruthy();
  });

  it("case detail and evidence (transcript + photo marking) visible", async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByText("night theft incident")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: /TR-0001/ })).toBeTruthy();
    expect(
      await screen.findByText("speaker 1: I saw it at night"),
    ).toBeTruthy();
    const detail = await screen.findByRole("region", { name: "Case detail" });
    expect(within(detail).getAllByText(/knife/).length).toBeGreaterThan(0);
    expect(within(detail).getByText(/1.*box/)).toBeTruthy();
  });

  it("shows a 'new similar cases' badge when fresh is false", async () => {
    stubFetch(false);
    renderPage();

    expect(await screen.findByText(/new similar cases/i)).toBeTruthy();
  });

  it("'Relevant' button fires links POST and shows confirmation", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const list = await screen.findByRole("list", { name: /similar/i });
    const buttons = within(list).getAllByRole("button", { name: /relevant/i });
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
      targetId: "case-2",
    });
    expect(await within(list).findByText(/approved/i)).toBeTruthy();
  });
});

describe("Case detail Evidence section", () => {
  it("no Edit Case link", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByText("night theft incident")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /edit case/i })).toBeNull();
    expect(document.querySelector('a[href$="/edit"]')).toBeNull();
  });

  it("draft evidence is not sent without Save; Save does a multipart POST", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const heading = await screen.findByRole("heading", { name: "Evidence" });
    const section = heading.closest("section") as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: "+ Add Evidence" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/evidence title/i), {
      target: { value: "New evidence" },
    });
    fireEvent.change(within(dialog).getByLabelText(/note/i), {
      target: { value: "evidence note" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use Evidence" }));
    expect(await within(section).findByText("New evidence")).toBeTruthy();

    const postsBefore = fetchMock.mock.calls.filter(
      ([url, init]) =>
        url === `/api/cases/${CASE_ID}/evidences` &&
        (init as RequestInit)?.method === "POST",
    );
    expect(postsBefore).toHaveLength(0);

    fireEvent.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const posts = fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === `/api/cases/${CASE_ID}/evidences` &&
          (init as RequestInit)?.method === "POST",
      );
      expect(posts).toHaveLength(1);
      const body = (posts[0][1] as RequestInit).body as FormData;
      expect(body.get("title")).toBe("New evidence");
      expect(body.get("note")).toBe("evidence note");
    });
    expect(await within(section).findByText(/Evidence saved/)).toBeTruthy();
  });

  it("no evidence controls for closed cases", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();
    const heading = await screen.findByRole("heading", { name: "Evidence" });
    const section = heading.closest("section") as HTMLElement;
    expect(
      within(section).queryByRole("button", { name: "+ Add Evidence" }),
    ).toBeNull();
    expect(
      within(section).queryByRole("button", { name: "Edit" }),
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
  fireEvent.click(screen.getByRole("button", { name: "+ Add Location" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/location title/i), {
    target: { value: title },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Use This Location" }),
  );
}

describe("Case detail Locations section", () => {
  it("(a) no legacy Location-type row; title+note+tag visible", async () => {
    stubFetch();
    renderPage();

    const detail = await screen.findByRole("region", { name: "Case detail" });
    expect(await within(detail).findByText("Stairwell entrance")).toBeTruthy();
    expect(within(detail).queryByText(/Location type/)).toBeNull();
    expect(within(detail).getByText("camera blind spot")).toBeTruthy();
    expect(within(detail).getByText("Crime Scene")).toBeTruthy();
    expect(within(detail).getByText("Back street")).toBeTruthy();
    expect(within(detail).getByText("escape route")).toBeTruthy();
    expect(within(detail).getByText("Critical")).toBeTruthy();
    // No warning band when a Crime Scene exists.
    expect(
      within(detail).queryByText(
        /No location.*Crime Scene/,
      ),
    ).toBeNull();
  });

  it("(b) draft row does no POST without Save; Cancel removes the row", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Stairwell entrance");
    await addDraftLocation("New point");

    expect(await screen.findByText("New point")).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("New point")).toBeNull();
    });
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(screen.getByText("Stairwell entrance")).toBeTruthy();
  });

  it("(c) Save applies POST/PATCH/DELETE deltas and shows the persisted state", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Back street");
    await addDraftLocation("New point");

    // Edit the existing location (draft).
    const editItem = (await screen.findByText("Back street")).closest("li");
    fireEvent.click(
      within(editItem as HTMLElement).getByRole("button", { name: "Edit" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/location title/i), {
      target: { value: "Back street (updated)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Back street (updated)")).toBeTruthy();

    // Delete the first location (draft).
    const deleteItem = screen.getByText("Stairwell entrance").closest("li");
    fireEvent.click(
      within(deleteItem as HTMLElement).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      expect(screen.queryByText("Stairwell entrance")).toBeNull();
    });
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(locationCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(locationCalls(fetchMock, "DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
      expect(locationCalls(fetchMock, "PATCH")).toHaveLength(1);
      expect(locationCalls(fetchMock, "DELETE")).toHaveLength(1);
    });
    const [, postInit] = locationCalls(fetchMock, "POST")[0];
    expect(JSON.parse(postInit.body as string)).toMatchObject({
      title: "New point",
    });
    const [patchUrl, patchInit] = locationCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/locations/loc-2`);
    expect(JSON.parse(patchInit.body as string)).toMatchObject({
      title: "Back street (updated)",
    });
    const [deleteUrl] = locationCalls(fetchMock, "DELETE")[0];
    expect(deleteUrl).toBe(`/api/cases/${CASE_ID}/locations/loc-1`);

    // After Save, Save/Cancel go away, persisted list remains.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });
    expect(screen.getByText("New point")).toBeTruthy();
    expect(screen.getByText("Back street (updated)")).toBeTruthy();
  });

  it("(d) no add/edit/delete buttons for closed cases", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();

    expect(await screen.findByText("Stairwell entrance")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "+ Add Location" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("(e) warning band visible for lists without a Crime Scene", async () => {
    stubFetch(false, {
      locations: [
        {
          id: "loc-2",
          caseId: CASE_ID,
          title: "Back street",
          note: "escape route",
          kind: "related",
          priority: "critical",
          createdAt: "2026-10-26T00:02:00.000Z",
        },
      ],
    });
    renderPage();

    expect(
      await screen.findByText(/No location.*Crime Scene/),
    ).toBeTruthy();
  });

  it("(f) 202 queued response shows 'Queued' and the draft counts as persisted", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();

    await screen.findByText("Stairwell entrance");
    await addDraftLocation("Queue point");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Queued/)).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });
    expect(screen.getByText("Queue point")).toBeTruthy();
  });

  it("(g) closing with a dirty draft drops Save/Cancel and location controls", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Stairwell entrance");
    await addDraftLocation("Closing draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close Case" }));

    expect(
      await screen.findByRole("button", { name: "Reopen Case" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "+ Add Location" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    // Unsaved draft rows also disappear (back to base).
    expect(screen.queryByText("Closing draft")).toBeNull();
    expect(screen.getByText("Stairwell entrance")).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(0);
    expect(locationCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(locationCalls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("(j) an offline (202) added location edited via PATCH goes to the same client id", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();
    await screen.findByText("Stairwell entrance");
    await addDraftLocation("Offline point");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Queued/)).toBeTruthy();
    const posts = locationCalls(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    const postedId = (JSON.parse(posts[0][1].body as string) as { id: string }).id;
    expect(typeof postedId).toBe("string");
    expect(postedId.length).toBeGreaterThan(0);

    const item = (await screen.findByText("Offline point")).closest("li");
    fireEvent.click(
      within(item as HTMLElement).getByRole("button", { name: "Edit" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/location title/i), {
      target: { value: "Offline point (updated)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(locationCalls(fetchMock, "PATCH")).toHaveLength(1);
    });
    const [patchUrl] = locationCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/locations/${postedId}`);
  });

  it("(h) on Save error the draft row and Save button are kept", async () => {
    const { fetchMock } = stubFetch(false, { failLocationSave: true });
    renderPage();

    await screen.findByText("Stairwell entrance");
    await addDraftLocation("Error draft");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(/Could not save locations/),
    ).toBeTruthy();
    expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    // Draft not deleted, user can retry.
    expect(screen.getByText("Error draft")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("(i) double-clicking Save does not duplicate POST", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    await screen.findByText("Stairwell entrance");
    await addDraftLocation("Single record");
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(locationCalls(fetchMock, "POST")).toHaveLength(1);
    });
    expect(await screen.findByText(/Locations saved/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
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
  const heading = await screen.findByRole("heading", { name: "People" });
  return heading.closest("section") as HTMLElement;
}

async function addDraftPerson(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Add Person" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(/full name/i), {
    target: { value: name },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Use This Person" }),
  );
}

describe("Case detail People section", () => {
  it("(a) no legacy person rows; name+type badge+relation+tags visible", async () => {
    stubFetch();
    renderPage();

    const detail = await screen.findByRole("region", { name: "Case detail" });
    const people = await peopleSectionEl();
    expect(await within(people).findByText("Alice Johnson")).toBeTruthy();
    expect(within(people).getByText("Victim")).toBeTruthy();
    expect(within(people).getByText("Brian Carter")).toBeTruthy();
    expect(within(people).getByText("Suspect")).toBeTruthy();
    expect(within(people).getByText("Witness")).toBeTruthy();
    expect(within(people).getByText(/Related Victim: Alice Johnson \(spouse\)/)).toBeTruthy();
    expect(within(people).getByText(/Related Victim: Alice Johnson \(neighbor\)/)).toBeTruthy();
    expect(within(people).getByText("Unidentified")).toBeTruthy();
    expect(within(people).getByText("Reached")).toBeTruthy();
    expect(within(people).getByText("Not reached")).toBeTruthy();
    expect(within(people).getByText("victim note")).toBeTruthy();
    // Legacy single person rows and values are not shown.
    expect(within(detail).queryByText(/Officer:/)).toBeNull();
    expect(within(detail).queryByText(/Victim age:/)).toBeNull();
    expect(within(detail).queryByText(/Victim gender:/)).toBeNull();
    expect(within(detail).queryByText(/Suspects:/)).toBeNull();
    expect(within(detail).queryByText(/Witnesses:/)).toBeNull();
    expect(within(detail).queryByText("Former Officer Name")).toBeNull();
    expect(within(detail).queryByText("Former Suspect Text")).toBeNull();
    expect(within(detail).queryByText("Former Witness Text")).toBeNull();
  });

  it("(b) draft person does no POST without Save; Cancel removes the row", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("New Person");

    expect(await within(people).findByText("New Person")).toBeTruthy();
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.click(
      within(people).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => {
      expect(within(people).queryByText("New Person")).toBeNull();
    });
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(within(people).getByText("Alice Johnson")).toBeTruthy();
  });

  it("(c) Save applies POST/PATCH/DELETE deltas", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("New Person");

    const editItem = (await within(people).findByText("Brian Carter")).closest("li");
    fireEvent.click(
      within(editItem as HTMLElement).getByRole("button", { name: "Edit" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/full name/i), {
      target: { value: "Brian Carter (updated)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(people).findByText("Brian Carter (updated)")).toBeTruthy();

    const deleteItem = within(people).getByText("witness note").closest("li");
    fireEvent.click(
      within(deleteItem as HTMLElement).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      expect(within(people).queryByText("witness note")).toBeNull();
    });
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(personCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(personCalls(fetchMock, "DELETE")).toHaveLength(0);

    fireEvent.click(within(people).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(personCalls(fetchMock, "POST")).toHaveLength(1);
      expect(personCalls(fetchMock, "PATCH")).toHaveLength(1);
      expect(personCalls(fetchMock, "DELETE")).toHaveLength(1);
    });
    const [, postInit] = personCalls(fetchMock, "POST")[0];
    expect(JSON.parse(postInit.body as string)).toMatchObject({
      name: "New Person",
      type: "victim",
    });
    const [patchUrl, patchInit] = personCalls(fetchMock, "PATCH")[0];
    expect(patchUrl).toBe(`/api/cases/${CASE_ID}/persons/kisi-2`);
    expect(JSON.parse(patchInit.body as string)).toMatchObject({
      name: "Brian Carter (updated)",
    });
    const [deleteUrl] = personCalls(fetchMock, "DELETE")[0];
    expect(deleteUrl).toBe(`/api/cases/${CASE_ID}/persons/kisi-3`);

    await waitFor(() => {
      expect(
        within(people).queryByRole("button", { name: "Save" }),
      ).toBeNull();
    });
    expect(within(people).getByText("New Person")).toBeTruthy();
    expect(within(people).getByText("Brian Carter (updated)")).toBeTruthy();
  });

  it("(d) no person controls for closed cases", async () => {
    stubFetch(false, { status: "closed" });
    renderPage();

    const people = await peopleSectionEl();
    expect(await within(people).findByText("Alice Johnson")).toBeTruthy();
    expect(
      within(people).queryByRole("button", { name: "+ Add Person" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Edit" }),
    ).toBeNull();
    expect(within(people).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Save" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "Cancel" }),
    ).toBeNull();
  });

  it("(e) dirty person draft row disappears on close", async () => {
    const { fetchMock } = stubFetch();
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Closing Person");
    expect(
      within(people).getByRole("button", { name: "Save" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close Case" }));

    expect(
      await screen.findByRole("button", { name: "Reopen Case" }),
    ).toBeTruthy();
    expect(within(people).queryByText("Closing Person")).toBeNull();
    expect(within(people).getByText("Alice Johnson")).toBeTruthy();
    expect(
      within(people).queryByRole("button", { name: "Save" }),
    ).toBeNull();
    expect(
      within(people).queryByRole("button", { name: "+ Add Person" }),
    ).toBeNull();
    expect(personCalls(fetchMock, "POST")).toHaveLength(0);
    expect(personCalls(fetchMock, "PATCH")).toHaveLength(0);
    expect(personCalls(fetchMock, "DELETE")).toHaveLength(0);
  });

  it("(g) 202 queued response shows 'Queued', not 'People saved.'; double-click does not repeat POST", async () => {
    const { fetchMock } = stubFetch(false, { queued: true });
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Queued Person");
    const saveButton = within(people).getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(await within(people).findByText(/Queued/)).toBeTruthy();
    expect(within(people).queryByText(/People saved\./)).toBeNull();
    expect(personCalls(fetchMock, "POST")).toHaveLength(1);
    await waitFor(() => {
      expect(
        within(people).queryByRole("button", { name: "Save" }),
      ).toBeNull();
    });
  });

  it("(f) draft preserved on Save error", async () => {
    const { fetchMock } = stubFetch(false, { failPersonSave: true });
    renderPage();

    const people = await peopleSectionEl();
    await addDraftPerson("Error Person");
    fireEvent.click(within(people).getByRole("button", { name: "Save" }));

    expect(
      await within(people).findByText(/Could not save people/),
    ).toBeTruthy();
    expect(personCalls(fetchMock, "POST")).toHaveLength(1);
    expect(within(people).getByText("Error Person")).toBeTruthy();
    expect(
      within(people).getByRole("button", { name: "Save" }),
    ).toBeTruthy();
    expect(
      within(people).getByRole("button", { name: "Cancel" }),
    ).toBeTruthy();
  });
});
