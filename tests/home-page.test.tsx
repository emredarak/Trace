// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "../app/page";

afterEach(() => cleanup());

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Ana sayfa vaka listeleri", () => {
  it("açık ve kapalı vakaları ayrı bölümlerde gösterir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: "a", caseNo: "TR-0001", summary: "açık iş", status: "open" },
          { id: "b", caseNo: "TR-0002", summary: "kapanmış iş", status: "closed" },
        ],
      }),
    );
    render(<Home />);

    expect(await screen.findByText(/Aktif Vakalar \(1\)/)).toBeTruthy();
    expect(await screen.findByText(/Geçmiş Vakalar \(1\)/)).toBeTruthy();
    expect(screen.getByText(/TR-0001/)).toBeTruthy();
    expect(screen.getByText(/TR-0002/)).toBeTruthy();
  });

  it("sunucu hatasında uyarı gösterir", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    render(<Home />);

    expect(await screen.findByText(/vakalar alınamadı/i)).toBeTruthy();
  });
});
