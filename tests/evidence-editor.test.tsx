// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import EvidenceEditor from "../app/components/evidence-editor";
import EvidenceSection from "../app/components/evidence-section";
import type { CaseEvidenceDraft } from "../lib/evidences";

afterEach(() => cleanup());

describe("EvidenceEditor", () => {
  it("title required and at least one content; note alone suffices", () => {
    const onConfirm = vi.fn();
    render(<EvidenceEditor initial={null} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Use Evidence" }));
    expect(screen.getByRole("alert").textContent).toMatch(/evidence title/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/evidence title/i), { target: { value: "Casing" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Evidence" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least one/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "9mm casing" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Evidence" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const draft = onConfirm.mock.calls[0][0] as CaseEvidenceDraft;
    expect(draft).toMatchObject({ title: "Casing", note: "9mm casing" });
    expect(draft.id.length).toBeGreaterThan(0);
  });

  it("image file alone suffices", () => {
    const onConfirm = vi.fn();
    render(<EvidenceEditor initial={null} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/evidence title/i), { target: { value: "Photo" } });
    const file = new File(["img"], "f.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/image/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Use Evidence" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const draft = onConfirm.mock.calls[0][0] as CaseEvidenceDraft;
    expect(draft.image).toBe(file);
  });
});

function Harness() {
  const [items, setItems] = useState<CaseEvidenceDraft[]>([]);
  return <EvidenceSection evidences={items} onChange={setItems} idPrefix="test" />;
}

describe("EvidenceSection", () => {
  it("+ Add Evidence adds draft; saved image/audio/note visible on card", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Evidence" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/evidence title/i), { target: { value: "Knife" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "has marks on it" } });
    fireEvent.click(screen.getByRole("button", { name: "Use Evidence" }));
    expect(await screen.findByText("Knife")).toBeTruthy();
    expect(screen.getByText("has marks on it")).toBeTruthy();
  });

  it("saved audio and image render as player/image", () => {
    const items: CaseEvidenceDraft[] = [
      {
        id: "e1",
        title: "Interview",
        note: "",
        type: "evidence",
        imageFile: "f.jpg",
        audioFile: "s.mp3",
      },
    ];
    const { container } = render(
      <EvidenceSection evidences={items} onChange={vi.fn()} idPrefix="test" readOnly />,
    );
    expect(screen.getByText("Interview")).toBeTruthy();
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("s.mp3");
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("f.jpg");
  });
});
