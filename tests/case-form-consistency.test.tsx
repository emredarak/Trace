// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NewCasePage from "../app/new/page";
import EditForm from "../app/cases/[id]/edit/edit-form";

afterEach(() => cleanup());
beforeEach(() => {
  vi.unstubAllGlobals();
});

const SHARED_LABELS = [
  /özet/i,
  /olay tarihi/i,
  /suç tipi/i,
  /yöntem/i,
  /silah/i,
  /sorumlu memur/i,
  /maktul yaşı/i,
  /maktul cinsiyeti/i,
  /şüpheliler/i,
  /tanıklar/i,
];

function expectLocationsSection() {
  expect(screen.getByText("Konumlar")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "+ Konum Ekle" }),
  ).toBeTruthy();
  // Panel kapalıyken gömülü seçim haritası/paneli yoktur.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText(/konum tipi/i)).toBeNull();
  expect(screen.queryByLabelText(/konum \(metin\)/i)).toBeNull();
  expect(screen.queryByLabelText(/konum açıklaması/i)).toBeNull();
}

function openPickerAndExpectFields() {
  fireEvent.click(screen.getByRole("button", { name: "+ Konum Ekle" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByLabelText(/konum başlığı/i)).toBeTruthy();
  expect(screen.getByLabelText("Konum Not")).toBeTruthy();
}

describe("vaka açma ve düzenleme formları tutarlı", () => {
  it("yeni vaka formu tüm ortak alanları gösterir", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<NewCasePage />);
    for (const label of SHARED_LABELS) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expectLocationsSection();
    openPickerAndExpectFields();
  });

  it("düzenleme formu aynı alanları + değiştirilemez sistem bilgilerini gösterir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "v1",
          caseNo: "TR-0042",
          summary: "eski özet",
          crimeType: "gasp",
          status: "open",
          createdAt: "2026-10-20T10:00:00.000Z",
          updatedAt: "2026-10-21T10:00:00.000Z",
          locations: [],
        }),
      }),
    );
    render(<EditForm caseId="v1" />);
    for (const label of SHARED_LABELS) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    expect(await screen.findByText(/TR-0042/)).toBeTruthy();
    expectLocationsSection();
    openPickerAndExpectFields();
    expect(screen.getByText(/değiştirilemez/i)).toBeTruthy();
    // Sistem alanları form girdisi değildir: vaka no düzenlenemez.
    expect(screen.queryByLabelText(/vaka no/i)).toBeNull();
  });
});
