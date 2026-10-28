// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PersonEditor from "../app/components/person-editor";
import type { CasePersonDraft } from "../lib/persons";

afterEach(() => cleanup());

function draft(overrides: Partial<CasePersonDraft> = {}): CasePersonDraft {
  return {
    id: "p-1",
    name: "Witness A",
    age: "",
    gender: "",
    note: "",
    type: "witness",
    relatedVictimId: "",
    relationship: "",
    unidentified: false,
    contactStatus: "",
    ...overrides,
  };
}

describe("PersonEditor interview audio", () => {
  it("witness shows audio field, victim hides it; file goes to draft", () => {
    const onConfirm = vi.fn();
    render(<PersonEditor initial={draft()} victims={[]} onClose={vi.fn()} onConfirm={onConfirm} />);
    const input = screen.getByLabelText(/interview audio/i) as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(["audio"], "interview.mp3", { type: "audio/mpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CasePersonDraft).audio).toBe(file);
  });

  it("victim has no audio field", () => {
    render(
      <PersonEditor initial={draft({ type: "victim" })} victims={[]} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.queryByLabelText(/interview audio/i)).toBeNull();
  });

  it("saved audio plays in editor", () => {
    const { container } = render(
      <PersonEditor
        initial={draft({ audioFile: "recording.mp3" })}
        victims={[]}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const audio = container.querySelector("audio");
    expect(audio?.getAttribute("src")).toContain("recording.mp3");
  });
});
