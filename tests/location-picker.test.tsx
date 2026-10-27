// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LocationPicker from "../app/components/location-picker";
import type { CaseLocationDraft } from "../lib/locations";

vi.mock("../app/components/map-picker", () => ({
  default: ({
    pick,
    onPick,
  }: {
    pick?: { latitude: number; longitude: number } | null;
    onPick?: (p: { latitude: number; longitude: number }) => void;
  }) => (
    <div>
      <span>
        {pick ? `pin:${pick.latitude},${pick.longitude}` : "pin:yok"}
      </span>
      <button
        type="button"
        onClick={() => onPick?.({ latitude: 40.1, longitude: 29.2 })}
      >
        Harita noktası seç
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubGeolocation(impl: {
  getCurrentPosition: (
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    err?: (e: { message: string }) => void,
  ) => void;
}) {
  Object.defineProperty(navigator, "geolocation", {
    value: impl,
    configurable: true,
  });
}

describe("LocationPicker", () => {
  it("başlık boşken hata gösterir ve onConfirm çağrılmaz; dolunca taslak taşınır", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    expect(
      screen.getByRole("dialog", { name: "Konum Seç" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));
    expect(screen.getByRole("alert").textContent).toMatch(/başlığ/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Köprü altı" },
    });
    fireEvent.change(screen.getByLabelText("Konum Not"), {
      target: { value: "delil bulundu" },
    });
    fireEvent.change(screen.getByLabelText(/Öncelik/), {
      target: { value: "kritik" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.title).toBe("Köprü altı");
    expect(draft.note).toBe("delil bulundu");
    expect(draft.kind).toBe("iliskili");
    expect(draft.priority).toBe("kritik");
    expect(typeof draft.id).toBe("string");
    expect(draft.id.length).toBeGreaterThan(0);
  });

  it("öncelik yalnızca İlişkili seçiliyken görünür", () => {
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Öncelik/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Olay Yeri"));
    expect(screen.queryByLabelText(/Öncelik/)).toBeNull();

    fireEvent.click(screen.getByLabelText("İlişkili Konum"));
    expect(screen.getByLabelText(/Öncelik/)).toBeTruthy();
  });

  it("Olay Yeri seçiminde öncelik taslağa null yazılır", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Olay noktası" },
    });
    fireEvent.click(screen.getByLabelText("Olay Yeri"));
    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.kind).toBe("olay-yeri");
    expect(draft.priority).toBeNull();
  });

  it("adres sonucunda tıklanan nokta taslak koordinatı olur, hata çıkmaz", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { display_name: "Test Adres, Ankara", lat: "39.93", lon: "32.85" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Aranan yer" },
    });
    fireEvent.change(screen.getByLabelText("Konum Not"), {
      target: { value: "not korunur" },
    });
    fireEvent.change(screen.getByLabelText(/Adres/), {
      target: { value: "Test Adres" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("accept-language=tr");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=5");

    fireEvent.click(
      await screen.findByRole("button", { name: /Test Adres, Ankara/ }),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeCloseTo(39.93);
    expect(draft.longitude).toBeCloseTo(32.85);
    expect(draft.title).toBe("Aranan yer");
  });

  it("adres sonucu yoksa hata görünür ve başlık/not dolu kalır", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Başlığım" },
    });
    fireEvent.change(screen.getByLabelText("Konum Not"), {
      target: { value: "Notum" },
    });
    fireEvent.change(screen.getByLabelText(/Adres/), {
      target: { value: "olmayan yer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /bulunamadı|aranamadı/i,
    );
    expect(
      (screen.getByLabelText(/Konum Başlığı/) as HTMLInputElement).value,
    ).toBe("Başlığım");
    expect((screen.getByLabelText("Konum Not") as HTMLInputElement).value).toBe(
      "Notum",
    );
  });

  it("adres aramada ağ hatasında hata görünür ve başlık/not dolu kalır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ağ yok")));
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Başlığım" },
    });
    fireEvent.change(screen.getByLabelText("Konum Not"), {
      target: { value: "Notum" },
    });
    fireEvent.change(screen.getByLabelText(/Adres/), {
      target: { value: "bir yer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ara" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /aranamadı|bağlantı/i,
    );
    expect(
      (screen.getByLabelText(/Konum Başlığı/) as HTMLInputElement).value,
    ).toBe("Başlığım");
    expect((screen.getByLabelText("Konum Not") as HTMLInputElement).value).toBe(
      "Notum",
    );
  });

  it("Konumuma Git başarısında koordinat alınır", () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: 41.02, longitude: 28.97 } }),
    });
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "GPS noktası" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Konumuma Git" }));
    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeCloseTo(41.02);
    expect(draft.longitude).toBeCloseTo(28.97);
  });

  it("Konumuma Git reddinde okunabilir hata görünür", () => {
    stubGeolocation({
      getCurrentPosition: (_ok, err) => err?.({ message: "denied" }),
    });
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Konumuma Git" }));
    expect(screen.getByRole("alert").textContent).toMatch(/konum alınamadı/i);
  });

  it("harita seçimi temizlenince koordinatsız kaydedilir", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Konum Başlığı/), {
      target: { value: "Harita noktası" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Harita noktası seç" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Harita seçimini temizle" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bu Konumu Kullan" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeUndefined();
    expect(draft.longitude).toBeUndefined();
  });

  it("düzenleme modunda alanlar dolu gelir ve Kaydet aynı id ile döner", () => {
    const onConfirm = vi.fn();
    const initial: CaseLocationDraft = {
      id: "loc-1",
      title: "Eski başlık",
      note: "eski not",
      kind: "iliskili",
      priority: "rutin",
      latitude: 39.9,
      longitude: 32.8,
    };
    render(
      <LocationPicker
        initial={initial}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Konumu Düzenle" })).toBeTruthy();
    expect(
      (screen.getByLabelText(/Konum Başlığı/) as HTMLInputElement).value,
    ).toBe("Eski başlık");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.id).toBe("loc-1");
    expect(draft.priority).toBe("rutin");
    expect(draft.latitude).toBeCloseTo(39.9);
  });

  it("Vazgeç onClose çağırır", () => {
    const onClose = vi.fn();
    render(
      <LocationPicker initial={null} onClose={onClose} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
