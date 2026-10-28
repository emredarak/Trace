// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import NewCasePage from "../app/new/page";

afterEach(() => cleanup());

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("New case form (only summary required)", () => {
  it("blocks submit with empty summary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.click(screen.getByRole("button", { name: /create case/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/summary is required/i)).toBeTruthy();
  });

  it("calls POST /api/cases with filled summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0001" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: "night theft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create case/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cases");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      summary: "night theft",
    });
    expect(await screen.findByText(/TR-0001/)).toBeTruthy();
  });

  it("adds location without coordinates from panel and sends with new fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0002" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: "incident" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Location" }));
    fireEvent.change(screen.getByLabelText(/location title/i), {
      target: { value: "Bazaar square" },
    });
    fireEvent.change(screen.getByLabelText("Location Note"), {
      target: { value: "corner the witness saw" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Use This Location" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /create case/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ summary: "incident" });
    expect(body).not.toHaveProperty("locationText");
    expect(body.locations).toEqual([
      {
        title: "Bazaar square",
        note: "corner the witness saw",
        kind: "related",
        priority: null,
        latitude: null,
        longitude: null,
      },
    ]);
  });

  it("Enter in Location Title field does not trigger case submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0003" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);
    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: "incident summary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Location" }));
    const titleInput = screen.getByLabelText(/location title/i);
    fireEvent.change(titleInput, { target: { value: "Enter place" } });
    const notPrevented = fireEvent.keyDown(titleInput, { key: "Enter" });
    // Dialog preventDefaults Enter; no form submit.
    expect(notPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    const noteInput = screen.getByLabelText("Location Note");
    expect(fireEvent.keyDown(noteInput, { key: "Enter" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds person from panel and sends persons with new fields, old five fields absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0004" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "incident" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Person" }));
    fireEvent.change(screen.getByLabelText(/Full Name/), { target: { value: "Alice Johnson" } });
    fireEvent.change(screen.getByLabelText(/Age/), { target: { value: "34" } });
    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));
    expect(screen.getByText("Alice Johnson")).toBeTruthy();
    expect(screen.getByText("Victim")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /create case/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("officer");
    expect(body).not.toHaveProperty("victimAge");
    expect(body).not.toHaveProperty("victimGender");
    expect(body).not.toHaveProperty("suspects");
    expect(body).not.toHaveProperty("witnesses");
    const persons = body.persons as Record<string, unknown>[];
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({
      name: "Alice Johnson", age: 34, gender: null, note: null, type: "victim",
      relatedVictimId: null, relationship: null, unidentified: false, contactStatus: null,
    });
    expect(typeof persons[0].id).toBe("string");
    expect((persons[0].id as string).length).toBeGreaterThan(0);
  });

  it("Enter in person Name field does not trigger case submit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0005" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "incident summary" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add Person" }));
    const nameInput = screen.getByLabelText(/Full Name/);
    fireEvent.change(nameInput, { target: { value: "Enter Person" } });
    expect(fireEvent.keyDown(nameInput, { key: "Enter" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("202 {queued:true} (ok:true) shows 'queued' and does not render undefined link", async () => {
    // Real fetch meaning: 202 response has ok:true.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ queued: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: "night theft" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create case/i }));

    expect(await screen.findByText(/queued/i)).toBeTruthy();
    // Regression guard: must not render "created" screen with undefined id/caseNo.
    expect(screen.queryByText(/case created/i)).toBeNull();
    expect(screen.queryByText(/add evidence/i)).toBeNull();
  });
});
