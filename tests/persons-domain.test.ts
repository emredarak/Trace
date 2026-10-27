import { beforeEach, describe, expect, it } from "vitest";
import {
  PERSON_GENDERS,
  normalizePersonInput,
  normalizePersonsInput,
  personTypeColor,
  personTypeLabel,
} from "../lib/persons";
import { validateCaseInput } from "../lib/case-schema";
import { closeDb, getDb, initDb, insertCase } from "../lib/db";

describe("personTypeLabel / personTypeColor", () => {
  it("tip etiketlerini döner", () => {
    expect(personTypeLabel("maktul")).toBe("Maktül");
    expect(personTypeLabel("tanik")).toBe("Tanık");
    expect(personTypeLabel("supheli")).toBe("Şüpheli");
  });

  it("spec hex renklerini döner", () => {
    expect(personTypeColor("maktul")).toEqual({ bg: "#990000", fg: "#FFFFFF" });
    expect(personTypeColor("supheli")).toEqual({ bg: "#6B21A8", fg: "#FFFFFF" });
    expect(personTypeColor("tanik")).toEqual({ bg: "#0050A0", fg: "#FFFFFF" });
  });

  it("cinsiyet listesini döner", () => {
    expect(PERSON_GENDERS).toEqual(["kadın", "erkek", "bilinmiyor"]);
  });
});

describe("normalizePersonInput", () => {
  it("tanıkta ilişki alanlarını korur ve metinleri kırpar", () => {
    expect(
      normalizePersonInput({
        id: " tanik-1 ",
        name: "  Ayşe Yılmaz ",
        age: 34,
        gender: "kadın",
        note: "  olay yerindeydi ",
        type: "tanik",
        relatedVictimId: " maktul-1 ",
        relationship: " eşi ",
        unidentified: false,
        contactStatus: "ulasildi",
      }),
    ).toEqual({
      id: "tanik-1",
      name: "Ayşe Yılmaz",
      age: 34,
      gender: "kadın",
      note: "olay yerindeydi",
      type: "tanik",
      relatedVictimId: "maktul-1",
      relationship: "eşi",
      unidentified: false,
      contactStatus: "ulasildi",
    });
  });

  it("maktülde ilişki alanlarını null'a zorlar", () => {
    const p = normalizePersonInput({
      name: "Maktül Kişi",
      type: "maktul",
      relatedVictimId: "baskasi",
      relationship: "eşi",
    });
    expect(p.relatedVictimId).toBeNull();
    expect(p.relationship).toBeNull();
  });

  it("ilişkili maktül yoksa ilişki metnini de null yapar", () => {
    const p = normalizePersonInput({
      name: "Tanık",
      type: "supheli",
      relationship: "komşusu",
    });
    expect(p.relatedVictimId).toBeNull();
    expect(p.relationship).toBeNull();
  });

  it("işaretsiz boş ad hata, işaretli boş ad kabul edilir", () => {
    expect(() => normalizePersonInput({ name: "  ", type: "tanik" })).toThrow();
    expect(() => normalizePersonInput({ type: "tanik" })).toThrow();
    const p = normalizePersonInput({ name: "  ", type: "tanik", unidentified: true });
    expect(p.name).toBeNull();
    expect(p.unidentified).toBe(true);
  });

  it("yaş: -1/121/1.5 hata, boş ve sınır değerler kabul", () => {
    for (const age of [-1, 121, 1.5]) {
      expect(() => normalizePersonInput({ name: "A", type: "maktul", age })).toThrow();
    }
    expect(normalizePersonInput({ name: "A", type: "maktul" }).age).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "maktul", age: "" }).age).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "maktul", age: 0 }).age).toBe(0);
    expect(normalizePersonInput({ name: "A", type: "maktul", age: 120 }).age).toBe(120);
  });

  it("geçersiz tip/cinsiyet/iletişim durumu hata verir", () => {
    expect(() => normalizePersonInput({ name: "A", type: "baska" })).toThrow();
    expect(() => normalizePersonInput({ name: "A" })).toThrow();
    expect(
      () => normalizePersonInput({ name: "A", type: "maktul", gender: "diger" }),
    ).toThrow();
    expect(
      () => normalizePersonInput({ name: "A", type: "maktul", contactStatus: "belki" }),
    ).toThrow();
    expect(
      normalizePersonInput({ name: "A", type: "maktul", contactStatus: "ulasilamadi" })
        .contactStatus,
    ).toBe("ulasilamadi");
    expect(normalizePersonInput({ name: "A", type: "maktul" }).contactStatus).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "maktul", gender: "" }).gender).toBeNull();
  });

  it("nesne olmayan giriş hata verir", () => {
    expect(() => normalizePersonInput(null)).toThrow();
    expect(() => normalizePersonInput("kişi")).toThrow();
  });
});

describe("normalizePersonsInput", () => {
  it("dizi olmayan giriş hata verir, boş dizi kabul edilir", () => {
    expect(() => normalizePersonsInput({})).toThrow();
    expect(normalizePersonsInput([])).toEqual([]);
  });

  it("maktül olmayan kişiye ilişki hata verir", () => {
    expect(() =>
      normalizePersonsInput([
        { id: "t1", name: "Tanık", type: "tanik" },
        { id: "s1", name: "Şüpheli", type: "supheli", relatedVictimId: "t1" },
      ]),
    ).toThrow();
  });

  it("dizide olmayan kişiye ilişki hata verir", () => {
    expect(() =>
      normalizePersonsInput([
        { id: "s1", name: "Şüpheli", type: "supheli", relatedVictimId: "yok" },
      ]),
    ).toThrow();
  });

  it("kimliği olmayan maktüle ilişki kurulamaz", () => {
    expect(() =>
      normalizePersonsInput([
        { name: "Maktül", type: "maktul" },
        { id: "s1", name: "Şüpheli", type: "supheli", relatedVictimId: "yok" },
      ]),
    ).toThrow();
  });

  it("aynı dizideki istemci kimlikli maktüle ilişki kabul edilir (maktül sonra da olabilir)", () => {
    const persons = normalizePersonsInput([
      {
        id: "s1",
        name: "Şüpheli",
        type: "supheli",
        relatedVictimId: "m1",
        relationship: "komşusu",
      },
      { id: "m1", name: "Maktül", type: "maktul" },
    ]);
    expect(persons[0].relatedVictimId).toBe("m1");
    expect(persons[0].relationship).toBe("komşusu");
  });
});

describe("validateCaseInput persons", () => {
  it("persons dizisini normalize eder, geçersiz ilişkiyi reddeder", () => {
    const out = validateCaseInput({
      summary: "vaka",
      persons: [{ id: "m1", name: "Maktül", type: "maktul" }],
    });
    expect(out.persons).toHaveLength(1);
    expect(out.persons?.[0]).toMatchObject({ id: "m1", type: "maktul" });
    expect(() =>
      validateCaseInput({
        summary: "vaka",
        persons: [{ name: "T", type: "tanik", relatedVictimId: "yok" }],
      }),
    ).toThrow();
    expect(validateCaseInput({ summary: "vaka" }).persons).toBeUndefined();
  });
});

describe("insertCase persons (iki aşamalı)", () => {
  beforeEach(() => {
    process.env.TRACE_DB_PATH = ":memory:";
    closeDb();
    initDb();
  });

  it("maktül dizide sonra gelse bile ilişkili kişileri case_persons'a yazar", () => {
    const rec = insertCase({
      summary: "kişili vaka",
      persons: normalizePersonsInput([
        {
          id: "s1",
          name: "Şüpheli",
          type: "supheli",
          relatedVictimId: "m1",
          relationship: "komşusu",
        },
        { id: "m1", name: "Maktül", type: "maktul", unidentified: false },
        { name: "Adsız", type: "tanik", unidentified: true },
      ]),
    });
    const rows = getDb()
      .prepare(
        "SELECT id, name, type, relatedVictimId, relationship, unidentified FROM case_persons WHERE caseId = ? ORDER BY rowid ASC",
      )
      .all(rec.id) as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: "s1",
      relatedVictimId: "m1",
      relationship: "komşusu",
    });
    expect(rows[1]).toMatchObject({ id: "m1", type: "maktul", relatedVictimId: null });
    expect(rows[2].id).toBeTruthy();
    expect(rows[2].id).not.toBe("s1");
    expect(rows[2]).toMatchObject({ name: "Adsız", unidentified: 1 });
  });
});
