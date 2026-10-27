// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EditForm from "../app/cases/[id]/edit/edit-form";

afterEach(() => cleanup());
beforeEach(() => { vi.unstubAllGlobals(); });

const CASE = {
  id: "v1", caseNo: "TR-0042", summary: "eski özet", status: "open",
  locations: [
    { id: "loc-1", caseId: "v1", title: "Silinecek", note: "", kind: "iliskili", priority: null, latitude: null, longitude: null },
    { id: "loc-2", caseId: "v1", title: "Güncellenecek", note: "", kind: "iliskili", priority: null, latitude: null, longitude: null },
  ],
};

function stub(queued = false) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cases/v1" && !init?.method) return { ok: true, status: 200, json: async () => CASE };
    if (url === "/api/cases/v1" && init?.method === "PATCH") return { ok: true, status: 200, json: async () => ({ ...CASE }) };
    if (url === "/api/cases/v1/locations" && init?.method === "POST") {
      if (queued) return { ok: true, status: 202, json: async () => ({ queued: true }) };
      const body = JSON.parse(init.body as string);
      return { ok: true, status: 201, json: async () => ({ id: body.id, caseId: "v1", ...body }) };
    }
    if (url.startsWith("/api/cases/v1/locations/")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`beklenmeyen ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}
const locCalls = (calls: {url:string;init?:RequestInit}[], m: string) => calls.filter(c => c.url.includes("/locations") && c.init?.method === m);

describe("EditForm konum fark senkronu", () => {
  it("Kaydet'te bir POST (istemci id ile) + bir PATCH + bir DELETE yapar", async () => {
    const { calls } = stub();
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek");
    // sil
    const delItem = screen.getByText("Silinecek").closest("li");
    fireEvent.click(within(delItem as HTMLElement).getByRole("button", { name: "Sil" }));
    // düzenle
    const editItem = screen.getByText("Güncellenecek").closest("li");
    fireEvent.click(within(editItem as HTMLElement).getByRole("button", { name: "Düzenle" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/konum başlığı/i), { target: { value: "Güncel başlık" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    // ekle
    fireEvent.click(screen.getByRole("button", { name: "+ Konum Ekle" }));
    const d2 = await screen.findByRole("dialog");
    fireEvent.change(within(d2).getByLabelText(/konum başlığı/i), { target: { value: "Yeni yer" } });
    fireEvent.click(within(d2).getByRole("button", { name: "Bu Konumu Kullan" }));
    // form Kaydet (dialog dışı tek Kaydet)
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(locCalls(calls, "DELETE")).toHaveLength(1));
    expect(locCalls(calls, "POST")).toHaveLength(1);
    expect(locCalls(calls, "PATCH").filter(c=>c.url.includes("/locations/"))).toHaveLength(1);
    const postBody = JSON.parse(locCalls(calls,"POST")[0].init!.body as string);
    expect(postBody.title).toBe("Yeni yer");
    expect(typeof postBody.id).toBe("string"); expect(postBody.id.length).toBeGreaterThan(0);
    expect(locCalls(calls,"PATCH")[0].url).toBe("/api/cases/v1/locations/loc-2");
    expect(locCalls(calls,"DELETE")[0].url).toBe("/api/cases/v1/locations/loc-1");
    expect(await screen.findByText("Kaydedildi.")).toBeTruthy();
  });

  it("Vazgeç bağlantısı konum isteği yapmaz", async () => {
    const { calls } = stub();
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek");
    expect(locCalls(calls,"POST")).toHaveLength(0);
    expect(calls.filter(c=>c.url.includes("/locations") && c.init?.method && c.init.method!=="GET")).toHaveLength(0);
  });

  it("202 kuyruk yanıtında Kaydedildi yerine Kuyruğa alındı gösterir", async () => {
    stub(true);
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek");
    fireEvent.click(screen.getByRole("button", { name: "+ Konum Ekle" }));
    const d = await screen.findByRole("dialog");
    fireEvent.change(within(d).getByLabelText(/konum başlığı/i), { target: { value: "Kuyruk yeri" } });
    fireEvent.click(within(d).getByRole("button", { name: "Bu Konumu Kullan" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText(/Kuyruğa alındı/)).toBeTruthy();
    expect(screen.queryByText("Kaydedildi.")).toBeNull();
  });
});
