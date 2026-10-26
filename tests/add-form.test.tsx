// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddEvidenceForm from "../app/cases/[id]/add/form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function queuedResponse() {
  // Gerçek fetch anlami: 202 yanıtında ok:true'dur.
  return {
    ok: true,
    status: 202,
    json: async () => ({ queued: true }),
  };
}

describe("delil formu kuyruk yanıtı (202)", () => {
  it("not 202 {queued:true} alınca 'kuyruğa alındı' gösterir", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<AddEvidenceForm caseId="abc" />);

    fireEvent.change(screen.getByLabelText("Not"), {
      target: { value: "saha notu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Not Kaydet" }));

    expect(await screen.findByText(/kuyruğa alındı/i)).toBeTruthy();
    // Gerileme koruması: 202 ok:true olsa da "kaydedildi" görünmemeli.
    expect(screen.queryByText("Not kaydedildi.")).toBeNull();
  });

  it("fotoğraf 202 {queued:true} alınca 'kuyruğa alındı' gösterir", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AddEvidenceForm caseId="abc" />);

    const photoInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["baytlar"], "delil.jpg", { type: "image/jpeg" });
    fireEvent.change(photoInput, { target: { files: [file] } });

    expect(await screen.findByText(/kuyruğa alındı/i)).toBeTruthy();
    expect(screen.queryByText(/kaydedildi/i)).toBeNull();
  });

  it("ses 202 {queued:true} alınca 'kuyruğa alındı' gösterir", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AddEvidenceForm caseId="abc" />);

    const audioInput = container.querySelectorAll('input[type="file"]')[1];
    const file = new File(["ses"], "kayit.mp3", { type: "audio/mpeg" });
    fireEvent.change(audioInput, { target: { files: [file] } });

    expect(await screen.findByText(/kuyruğa alındı/i)).toBeTruthy();
    expect(screen.queryByText(/çözüldü/i)).toBeNull();
  });
});
