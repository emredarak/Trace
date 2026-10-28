// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import EvidenceEditor from "../app/components/evidence-editor";
import EvidenceSection from "../app/components/evidence-section";
import type { CaseEvidenceDraft } from "../lib/evidences";

afterEach(() => cleanup());

describe("EvidenceEditor", () => {
  it("başlık zorunlu ve en az bir içerik gerekir; not tek başına yeter", () => {
    const onConfirm = vi.fn();
    render(<EvidenceEditor initial={null} onClose={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Delili Kullan" }));
    expect(screen.getByRole("alert").textContent).toMatch(/başlı/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/başlı/i), { target: { value: "Kovan" } });
    fireEvent.click(screen.getByRole("button", { name: "Delili Kullan" }));
    expect(screen.getByRole("alert").textContent).toMatch(/görsel|ses|not/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/not/i), { target: { value: "9mm kovan" } });
    fireEvent.click(screen.getByRole("button", { name: "Delili Kullan" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const draft = onConfirm.mock.calls[0][0] as CaseEvidenceDraft;
    expect(draft).toMatchObject({ title: "Kovan", note: "9mm kovan" });
    expect(draft.id.length).toBeGreaterThan(0);
  });

  it("görsel dosyası tek başına yeter", () => {
    const onConfirm = vi.fn();
    render(<EvidenceEditor initial={null} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/başlı/i), { target: { value: "Foto" } });
    const file = new File(["img"], "f.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/görsel/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Delili Kullan" }));
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
  it("+ Delil Ekle taslak ekler; kayıtlı görsel/ses/not kartta görünür", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ Delil Ekle" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/başlı/i), { target: { value: "Bıçak" } });
    fireEvent.change(screen.getByLabelText(/not/i), { target: { value: "üzerinde iz var" } });
    fireEvent.click(screen.getByRole("button", { name: "Delili Kullan" }));
    expect(await screen.findByText("Bıçak")).toBeTruthy();
    expect(screen.getByText("üzerinde iz var")).toBeTruthy();
  });

  it("kayıtlı ses ve görsel oynatıcı/resim olarak görünür", () => {
    const items: CaseEvidenceDraft[] = [
      {
        id: "e1",
        title: "Sorgu",
        note: "",
        type: "evidence",
        imageFile: "f.jpg",
        audioFile: "s.mp3",
      },
    ];
    const { container } = render(
      <EvidenceSection evidences={items} onChange={vi.fn()} idPrefix="test" readOnly />,
    );
    expect(screen.getByText("Sorgu")).toBeTruthy();
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("s.mp3");
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toContain("f.jpg");
  });
});
