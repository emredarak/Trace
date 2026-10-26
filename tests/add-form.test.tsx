// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddEvidenceForm from "../app/cases/[id]/add/form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function queuedResponse() {
  return {
    ok: false,
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
  });
});
