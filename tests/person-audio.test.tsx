// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PersonEditor from "../app/components/person-editor";
import type { CasePersonDraft } from "../lib/persons";

afterEach(() => cleanup());

function draft(overrides: Partial<CasePersonDraft> = {}): CasePersonDraft {
  return {
    id: "p-1",
    name: "Tanık A",
    age: "",
    gender: "",
    note: "",
    type: "tanik",
    relatedVictimId: "",
    relationship: "",
    unidentified: false,
    contactStatus: "",
    ...overrides,
  };
}

describe("PersonEditor sorgu sesi", () => {
  it("tanıkta ses alanı görünür, maktülde görünmez; dosya taslağa taşınır", () => {
    const onConfirm = vi.fn();
    render(<PersonEditor initial={draft()} victims={[]} onClose={vi.fn()} onConfirm={onConfirm} />);
    const input = screen.getByLabelText(/sorgu ses/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(["ses"], "sorgu.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CasePersonDraft).audio).toBe(file);
  });

  it("maktülde ses alanı yoktur", () => {
    render(
      <PersonEditor initial={draft({ type: "maktul" })} victims={[]} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/sorgu ses/i)).toBeNull();
  });

  it("kayıtlı ses editörde dinlenebilir", () => {
    const { container } = render(
      <PersonEditor
        initial={draft({ audioFile: "kayit.mp3" })}
        victims={[]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("kayit.mp3");
  });
});
