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

describe("Yeni vaka formu (yalnız özet zorunlu)", () => {
  it("boş özetle gönderim engellenir", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.click(screen.getByRole("button", { name: /vakayı aç/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/özet zorunludur/i)).toBeTruthy();
  });

  it("dolu özetle POST /api/cases çağrılır", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0001" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/özet/i), {
      target: { value: "gece hırsızlık" },
    });
    fireEvent.click(screen.getByRole("button", { name: /vakayı aç/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cases");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      summary: "gece hırsızlık",
    });
    expect(await screen.findByText(/TR-0001/)).toBeTruthy();
  });

  it("panelden koordinatsız konum eklenip yeni alanlarla gönderilir", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "abc", caseNo: "TR-0002" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/özet/i), {
      target: { value: "olay" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Konum Ekle" }));
    fireEvent.change(screen.getByLabelText(/konum başlığı/i), {
      target: { value: "Çarşı meydanı" },
    });
    fireEvent.change(screen.getByLabelText("Konum Not"), {
      target: { value: "tanığın gördüğü köşe" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bu Konumu Kullan" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /vakayı aç/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ summary: "olay" });
    expect(body).not.toHaveProperty("locationText");
    expect(body.locations).toEqual([
      {
        title: "Çarşı meydanı",
        note: "tanığın gördüğü köşe",
        kind: "iliskili",
        priority: null,
        latitude: null,
        longitude: null,
      },
    ]);
  });

  it("202 {queued:true} alınca (ok:true) 'kuyruğa alındı' gösterir, tanımsız bağlantı çizmez", async () => {
    // Gerçek fetch anlami: 202 yanıtında ok:true'dur.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ queued: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<NewCasePage />);

    fireEvent.change(screen.getByLabelText(/özet/i), {
      target: { value: "gece hırsızlık" },
    });
    fireEvent.click(screen.getByRole("button", { name: /vakayı aç/i }));

    expect(await screen.findByText(/kuyruğa alındı/i)).toBeTruthy();
    // Gerileme koruması: tanımsız id/caseNo ile "açıldı" ekranı çizilmemeli.
    expect(screen.queryByText(/vaka açıldı/i)).toBeNull();
    expect(screen.queryByText(/delil ekle/i)).toBeNull();
  });
});
