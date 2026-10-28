// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AddEvidenceForm from "../app/cases/[id]/add/form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function queuedResponse() {
  // Real fetch meaning: a 202 response has ok:true.
  return {
    ok: true,
    status: 202,
    json: async () => ({ queued: true }),
  };
}

describe("evidence form queue response (202)", () => {
  it("note 202 {queued:true} shows 'queued' message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<AddEvidenceForm caseId="abc" />);

    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "field note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));

    expect(await screen.findByText(/queued/i)).toBeTruthy();
    // Regression guard: with 202 ok:true, "saved" must not appear.
    expect(screen.queryByText("Note saved.")).toBeNull();
  });

  it("photo 202 {queued:true} shows 'queued' message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AddEvidenceForm caseId="abc" />);

    const photoInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["bytes"], "evidence.jpg", { type: "image/jpeg" });
    fireEvent.change(photoInput, { target: { files: [file] } });

    expect(await screen.findByText(/queued/i)).toBeTruthy();
    expect(screen.queryByText(/saved/i)).toBeNull();
  });

  it("audio 202 {queued:true} shows 'queued' message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(queuedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<AddEvidenceForm caseId="abc" />);

    const audioInput = container.querySelectorAll('input[type="file"]')[1];
    const file = new File(["audio"], "recording.mp3", { type: "audio/mpeg" });
    fireEvent.change(audioInput, { target: { files: [file] } });

    expect(await screen.findByText(/queued/i)).toBeTruthy();
    expect(screen.queryByText(/Audio transcribed:/)).toBeNull();
  });
});
