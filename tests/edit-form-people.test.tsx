// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EditForm from "../app/cases/[id]/edit/edit-form";

afterEach(() => cleanup());
beforeEach(() => { vi.unstubAllGlobals(); });

const CASE = {
  id: "v1", caseNo: "TR-0042", summary: "eski özet", status: "open",
  locations: [],
  persons: [
    { id: "pers-1", caseId: "v1", name: "Silinecek Maktül", age: 40, gender: "erkek", note: "", type: "maktul", relatedVictimId: null, relationship: null, unidentified: false, contactStatus: null, createdAt: "2026-10-20T10:00:00.000Z" },
    { id: "pers-2", caseId: "v1", name: "Güncellenecek Tanık", age: null, gender: null, note: "", type: "tanik", relatedVictimId: "pers-1", relationship: "komşusu", unidentified: false, contactStatus: null, createdAt: "2026-10-20T10:01:00.000Z" },
  ],
};

function stub(queued = false) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/cases/v1" && !init?.method) return { ok: true, status: 200, json: async () => CASE };
    if (url === "/api/cases/v1" && init?.method === "PATCH") return { ok: true, status: 200, json: async () => ({ ...CASE }) };
    if (url === "/api/cases/v1/persons" && init?.method === "POST") {
      if (queued) return { ok: true, status: 202, json: async () => ({ queued: true }) };
      const body = JSON.parse(init.body as string);
      return { ok: true, status: 201, json: async () => ({ id: body.id, caseId: "v1", ...body }) };
    }
    if (url.startsWith("/api/cases/v1/persons/")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`beklenmeyen ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}
const personCalls = (calls: {url:string;init?:RequestInit}[], m: string) => calls.filter(c => c.url.includes("/persons") && c.init?.method === m);

describe("EditForm kişi fark senkronu", () => {
  it("Kaydet'te bir POST (istemci id ile) + bir PATCH + bir DELETE yapar; silinen maktüle bağlı tanığın ilişkisi taslakta boşalır", async () => {
    const { calls } = stub();
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek Maktül");
    // bağlı ilişki satırda görünür
    const witnessItem = screen.getByText("Güncellenecek Tanık").closest("li") as HTMLElement;
    expect(within(witnessItem).getByText(/İlişkili Maktül: Silinecek Maktül \(komşusu\)/)).toBeTruthy();
    // maktülü sil
    const victimItem = screen.getByText("Silinecek Maktül").closest("li") as HTMLElement;
    fireEvent.click(within(victimItem).getByRole("button", { name: "Sil" }));
    // taslakta ilişki boşaldı
    const witnessAfter = screen.getByText("Güncellenecek Tanık").closest("li") as HTMLElement;
    expect(within(witnessAfter).queryByText(/İlişkili Maktül/)).toBeNull();
    // tanığı düzenle
    fireEvent.click(within(witnessAfter).getByRole("button", { name: "Düzenle" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Ad Soyad/), { target: { value: "Güncel Tanık" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Kaydet" }));
    // yeni kişi ekle
    fireEvent.click(screen.getByRole("button", { name: "+ Kişi Ekle" }));
    const d2 = await screen.findByRole("dialog");
    fireEvent.click(within(d2).getByLabelText("Şüpheli"));
    fireEvent.change(within(d2).getByLabelText(/Ad Soyad/), { target: { value: "Yeni Şüpheli" } });
    fireEvent.click(within(d2).getByRole("button", { name: "Kişiyi Kullan" }));
    // form Kaydet
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(personCalls(calls, "DELETE")).toHaveLength(1));
    expect(personCalls(calls, "POST")).toHaveLength(1);
    expect(personCalls(calls, "PATCH")).toHaveLength(1);
    const postBody = JSON.parse(personCalls(calls, "POST")[0].init!.body as string);
    expect(postBody.name).toBe("Yeni Şüpheli");
    expect(postBody.type).toBe("supheli");
    expect(typeof postBody.id).toBe("string"); expect(postBody.id.length).toBeGreaterThan(0);
    const patchCall = personCalls(calls, "PATCH")[0];
    expect(patchCall.url).toBe("/api/cases/v1/persons/pers-2");
    const patchBody = JSON.parse(patchCall.init!.body as string);
    expect(patchBody.name).toBe("Güncel Tanık");
    expect(patchBody.relatedVictimId).toBeNull();
    expect(patchBody.relationship).toBeNull();
    expect(personCalls(calls, "DELETE")[0].url).toBe("/api/cases/v1/persons/pers-1");
    expect(await screen.findByText("Kaydedildi.")).toBeTruthy();
  });

  it("Vazgeç kişi isteği yapmaz", async () => {
    const { calls } = stub();
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek Maktül");
    expect(personCalls(calls, "POST")).toHaveLength(0);
    expect(calls.filter(c => c.url.includes("/persons") && c.init?.method && c.init.method !== "GET")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Vazgeç" })).toBeTruthy();
  });

  it("202 kuyruk yanıtında Kaydedildi yerine Kuyruğa alındı gösterir", async () => {
    stub(true);
    render(<EditForm caseId="v1" />);
    await screen.findByText("Silinecek Maktül");
    fireEvent.click(screen.getByRole("button", { name: "+ Kişi Ekle" }));
    const d = await screen.findByRole("dialog");
    fireEvent.change(within(d).getByLabelText(/Ad Soyad/), { target: { value: "Kuyruk Kişisi" } });
    fireEvent.click(within(d).getByRole("button", { name: "Kişiyi Kullan" }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText(/Kuyruğa alındı/)).toBeTruthy();
    expect(screen.queryByText("Kaydedildi.")).toBeNull();
  });
});
