// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PersonEditor from "../app/components/person-editor";
import type { CasePersonDraft } from "../lib/persons";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function draft(overrides: Partial<CasePersonDraft> = {}): CasePersonDraft {
  return {
    id: "p-1",
    name: "",
    age: "",
    gender: "",
    note: "",
    type: "victim",
    relatedVictimId: "",
    relationship: "",
    unidentified: false,
    contactStatus: "",
    ...overrides,
  };
}

const victims: CasePersonDraft[] = [
  draft({ id: "v-1", name: "Alice Johnson", type: "victim" }),
  draft({ id: "v-2", name: "", type: "victim", unidentified: true }),
];

describe("PersonEditor", () => {
  it("empty name shows error; Unidentified allows nameless confirm", () => {
    const onConfirm = vi.fn();
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));
    expect(screen.getByRole("alert").textContent).toMatch(/full name/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Unidentified/));
    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result.name).toBe("");
    expect(result.unidentified).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("error clears when name typed or Unidentified enabled", () => {
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Full Name/), {
      target: { value: "A" },
    });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Full Name/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Unidentified/));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("unnamed victims distinguished in Related Victim options", () => {
    const unnamed: CasePersonDraft[] = [
      draft({ id: "v-1", name: "", age: "30", gender: "female", type: "victim", unidentified: true }),
      draft({ id: "v-2", name: "", age: "45", gender: "male", type: "victim", unidentified: true }),
    ];
    render(
      <PersonEditor
        initial={draft({ type: "witness", name: "Witness" })}
        victims={unnamed}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(/Related Victim/) as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.textContent);
    expect(texts[1]).toMatch(/Victim 1/);
    expect(texts[2]).toMatch(/Victim 2/);
    expect(texts[1]).not.toBe(texts[2]);
  });

  it("Related Victim and Relationship only visible for Witness/Suspect", () => {
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Related Victim/)).toBeNull();
    expect(screen.queryByLabelText("Relationship")).toBeNull();

    fireEvent.click(screen.getByLabelText("Witness"));
    expect(screen.getByLabelText(/Related Victim/)).toBeTruthy();
    expect(screen.getByLabelText("Relationship")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Suspect"));
    expect(screen.getByLabelText(/Related Victim/)).toBeTruthy();
    expect(screen.getByLabelText("Relationship")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Victim"));
    expect(screen.queryByLabelText(/Related Victim/)).toBeNull();
    expect(screen.queryByLabelText("Relationship")).toBeNull();
  });

  it("confirm carries all fields to draft", () => {
    const onConfirm = vi.fn();
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("Suspect"));
    fireEvent.change(screen.getByLabelText(/Full Name/), {
      target: { value: "Brian Carter" },
    });
    fireEvent.change(screen.getByLabelText(/Age/), {
      target: { value: "34" },
    });
    fireEvent.change(screen.getByLabelText(/Gender/), {
      target: { value: "male" },
    });
    fireEvent.change(screen.getByLabelText(/Note/), {
      target: { value: "was nearby on the day" },
    });
    const victimSelect = screen.getByLabelText(
      /Related Victim/,
    ) as HTMLSelectElement;
    expect(
      Array.from(victimSelect.options).map((o) => o.textContent),
    ).toEqual(["", "Alice Johnson", "Unidentified"]);
    fireEvent.change(victimSelect, { target: { value: "v-1" } });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "spouse" },
    });
    fireEvent.change(screen.getByLabelText(/Contact Status/), {
      target: { value: "reached" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Use This Person" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result).toMatchObject({
      name: "Brian Carter",
      age: "34",
      gender: "male",
      note: "was nearby on the day",
      type: "suspect",
      relatedVictimId: "v-1",
      relationship: "spouse",
      unidentified: false,
      contactStatus: "reached",
    });
  });

  it("Enter in Name field does not submit outer form", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PersonEditor
          initial={null}
          victims={victims}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      </form>,
    );
    const nameInput = screen.getByLabelText(/Full Name/);
    fireEvent.change(nameInput, { target: { value: "Enter Person" } });
    expect(fireEvent.keyDown(nameInput, { key: "Enter" })).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("edit mode prefills and Save returns same id", () => {
    const onConfirm = vi.fn();
    const initial = draft({
      id: "p-9",
      name: "Carol White",
      age: "41",
      gender: "female",
      note: "old note",
      type: "witness",
      relatedVictimId: "v-1",
      relationship: "neighbor",
      unidentified: false,
      contactStatus: "unreached",
    });
    render(
      <PersonEditor
        initial={initial}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(
      screen.getByRole("dialog", { name: "Edit Person" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText(/Full Name/) as HTMLInputElement).value,
    ).toBe("Carol White");
    expect((screen.getByLabelText(/Age/) as HTMLInputElement).value).toBe(
      "41",
    );
    expect(
      (screen.getByLabelText(/Gender/) as HTMLSelectElement).value,
    ).toBe("female");
    expect((screen.getByLabelText(/Note/) as HTMLInputElement).value).toBe(
      "old note",
    );
    expect(
      (screen.getByLabelText(/Related Victim/) as HTMLSelectElement).value,
    ).toBe("v-1");
    expect((screen.getByLabelText("Relationship") as HTMLInputElement).value).toBe(
      "neighbor",
    );
    expect(
      (screen.getByLabelText(/Contact Status/) as HTMLSelectElement).value,
    ).toBe("unreached");
    expect(
      (screen.getByLabelText("Witness") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result.id).toBe("p-9");
    expect(result.type).toBe("witness");
    expect(result.relatedVictimId).toBe("v-1");
    expect(result.relationship).toBe("neighbor");
  });

  it("Cancel calls onClose", () => {
    const onClose = vi.fn();
    render(
      <PersonEditor
        initial={null}
        onClose={onClose}
        onConfirm={vi.fn()}
        victims={victims}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
