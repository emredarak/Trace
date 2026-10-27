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
    type: "maktul",
    relatedVictimId: "",
    relationship: "",
    unidentified: false,
    contactStatus: "",
    ...overrides,
  };
}

const victims: CasePersonDraft[] = [
  draft({ id: "v-1", name: "Ayşe Yılmaz", type: "maktul" }),
  draft({ id: "v-2", name: "", type: "maktul", unidentified: true }),
];

describe("PersonEditor", () => {
  it("boş ad ile hata gösterir; Kimliği Tespit Edilemedi açılınca adsız onaylanır", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Kişiyi Kullan" }));
    expect(screen.getByRole("alert").textContent).toMatch(/ad/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Kimliği Tespit Edilemedi/));
    fireEvent.click(screen.getByRole("button", { name: "Kişiyi Kullan" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result.name).toBe("");
    expect(result.unidentified).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("İlişkili Maktül ve İlişki yalnızca Tanık/Şüpheli seçiliyken görünür", () => {
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/İlişkili Maktül/)).toBeNull();
    expect(screen.queryByLabelText("İlişki")).toBeNull();

    fireEvent.click(screen.getByLabelText("Tanık"));
    expect(screen.getByLabelText(/İlişkili Maktül/)).toBeTruthy();
    expect(screen.getByLabelText("İlişki")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Şüpheli"));
    expect(screen.getByLabelText(/İlişkili Maktül/)).toBeTruthy();
    expect(screen.getByLabelText("İlişki")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Maktül"));
    expect(screen.queryByLabelText(/İlişkili Maktül/)).toBeNull();
    expect(screen.queryByLabelText("İlişki")).toBeNull();
  });

  it("onay taslağı tüm alanları taşır", () => {
    const onConfirm = vi.fn();
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByLabelText("Şüpheli"));
    fireEvent.change(screen.getByLabelText(/Ad Soyad/), {
      target: { value: "Mehmet Demir" },
    });
    fireEvent.change(screen.getByLabelText(/Yaş/), {
      target: { value: "34" },
    });
    fireEvent.change(screen.getByLabelText(/Cinsiyet/), {
      target: { value: "erkek" },
    });
    fireEvent.change(screen.getByLabelText(/Not/), {
      target: { value: "olay günü yakındaydı" },
    });
    const victimSelect = screen.getByLabelText(
      /İlişkili Maktül/,
    ) as HTMLSelectElement;
    expect(
      Array.from(victimSelect.options).map((o) => o.textContent),
    ).toEqual(["", "Ayşe Yılmaz", "Kimliği tespit edilemedi"]);
    fireEvent.change(victimSelect, { target: { value: "v-1" } });
    fireEvent.change(screen.getByLabelText("İlişki"), {
      target: { value: "eşi" },
    });
    fireEvent.change(screen.getByLabelText(/Ulaşılma Durumu/), {
      target: { value: "ulasildi" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Kişiyi Kullan" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result).toMatchObject({
      name: "Mehmet Demir",
      age: "34",
      gender: "erkek",
      note: "olay günü yakındaydı",
      type: "supheli",
      relatedVictimId: "v-1",
      relationship: "eşi",
      unidentified: false,
      contactStatus: "ulasildi",
    });
  });

  it("panel içinde Ad alanında Enter vaka gönderimi yapmaz", () => {
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
    const nameInput = screen.getByLabelText(/Ad Soyad/);
    fireEvent.change(nameInput, { target: { value: "Enter Kişisi" } });
    expect(fireEvent.keyDown(nameInput, { key: "Enter" })).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("düzenleme modu alanları dolu açılır ve Kaydet aynı id ile döner", () => {
    const onConfirm = vi.fn();
    const initial = draft({
      id: "p-9",
      name: "Fatma Kaya",
      age: "41",
      gender: "kadın",
      note: "eski not",
      type: "tanik",
      relatedVictimId: "v-1",
      relationship: "komşusu",
      unidentified: false,
      contactStatus: "ulasilamadi",
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
      screen.getByRole("dialog", { name: "Kişiyi Düzenle" }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText(/Ad Soyad/) as HTMLInputElement).value,
    ).toBe("Fatma Kaya");
    expect((screen.getByLabelText(/Yaş/) as HTMLInputElement).value).toBe(
      "41",
    );
    expect(
      (screen.getByLabelText(/Cinsiyet/) as HTMLSelectElement).value,
    ).toBe("kadın");
    expect((screen.getByLabelText(/Not/) as HTMLInputElement).value).toBe(
      "eski not",
    );
    expect(
      (screen.getByLabelText(/İlişkili Maktül/) as HTMLSelectElement).value,
    ).toBe("v-1");
    expect((screen.getByLabelText("İlişki") as HTMLInputElement).value).toBe(
      "komşusu",
    );
    expect(
      (screen.getByLabelText(/Ulaşılma Durumu/) as HTMLSelectElement).value,
    ).toBe("ulasilamadi");
    expect(
      (screen.getByLabelText("Tanık") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0][0] as CasePersonDraft;
    expect(result.id).toBe("p-9");
    expect(result.type).toBe("tanik");
    expect(result.relatedVictimId).toBe("v-1");
    expect(result.relationship).toBe("komşusu");
  });

  it("Vazgeç onClose çağırır", () => {
    const onClose = vi.fn();
    render(
      <PersonEditor
        initial={null}
        victims={victims}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
