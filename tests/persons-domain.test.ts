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
  it("returns type labels", () => {
    expect(personTypeLabel("victim")).toBe("Victim");
    expect(personTypeLabel("witness")).toBe("Witness");
    expect(personTypeLabel("suspect")).toBe("Suspect");
  });

  it("returns spec hex colors", () => {
    expect(personTypeColor("victim")).toEqual({ bg: "#990000", fg: "#FFFFFF" });
    expect(personTypeColor("suspect")).toEqual({ bg: "#6B21A8", fg: "#FFFFFF" });
    expect(personTypeColor("witness")).toEqual({ bg: "#0050A0", fg: "#FFFFFF" });
  });

  it("returns the gender list", () => {
    expect(PERSON_GENDERS).toEqual(["female", "male", "unknown"]);
  });
});

describe("normalizePersonInput", () => {
  it("keeps relation fields for witnesses and trims text", () => {
    expect(
      normalizePersonInput({
        id: " witness-1 ",
        name: "  Alice Johnson ",
        age: 34,
        gender: "female",
        note: "  was at the scene ",
        type: "witness",
        relatedVictimId: " victim-1 ",
        relationship: " spouse ",
        unidentified: false,
        contactStatus: "reached",
      }),
    ).toEqual({
      id: "witness-1",
      name: "Alice Johnson",
      age: 34,
      gender: "female",
      note: "was at the scene",
      type: "witness",
      relatedVictimId: "victim-1",
      relationship: "spouse",
      unidentified: false,
      contactStatus: "reached",
    });
  });

  it("forces relation fields to null for victims", () => {
    const p = normalizePersonInput({
      name: "Victim Person",
      type: "victim",
      relatedVictimId: "someone-else",
      relationship: "spouse",
    });
    expect(p.relatedVictimId).toBeNull();
    expect(p.relationship).toBeNull();
  });

  it("nulls the relation text when there is no related victim", () => {
    const p = normalizePersonInput({
      name: "Witness",
      type: "suspect",
      relationship: "neighbor",
    });
    expect(p.relatedVictimId).toBeNull();
    expect(p.relationship).toBeNull();
  });

  it("unchecked empty name errors, checked empty name accepted", () => {
    expect(() => normalizePersonInput({ name: "  ", type: "witness" })).toThrow();
    expect(() => normalizePersonInput({ type: "witness" })).toThrow();
    const p = normalizePersonInput({ name: "  ", type: "witness", unidentified: true });
    expect(p.name).toBeNull();
    expect(p.unidentified).toBe(true);
  });

  it("age: -1/121/1.5 error, empty and boundary values accepted", () => {
    for (const age of [-1, 121, 1.5]) {
      expect(() => normalizePersonInput({ name: "A", type: "victim", age })).toThrow();
    }
    expect(normalizePersonInput({ name: "A", type: "victim" }).age).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "victim", age: "" }).age).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "victim", age: 0 }).age).toBe(0);
    expect(normalizePersonInput({ name: "A", type: "victim", age: 120 }).age).toBe(120);
    expect(normalizePersonInput({ name: "A", type: "victim", age: "   " }).age).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "victim", age: " 34 " }).age).toBe(34);
  });

  it("invalid type/gender/contact status errors", () => {
    expect(() => normalizePersonInput({ name: "A", type: "other" })).toThrow();
    expect(() => normalizePersonInput({ name: "A" })).toThrow();
    expect(
      () => normalizePersonInput({ name: "A", type: "victim", gender: "diverse" }),
    ).toThrow();
    expect(
      () => normalizePersonInput({ name: "A", type: "victim", contactStatus: "maybe" }),
    ).toThrow();
    expect(
      normalizePersonInput({ name: "A", type: "victim", contactStatus: "unreached" })
        .contactStatus,
    ).toBe("unreached");
    expect(normalizePersonInput({ name: "A", type: "victim" }).contactStatus).toBeNull();
    expect(normalizePersonInput({ name: "A", type: "victim", gender: "" }).gender).toBeNull();
  });

  it("non-object input errors", () => {
    expect(() => normalizePersonInput(null)).toThrow();
    expect(() => normalizePersonInput("person")).toThrow();
  });
});

describe("normalizePersonsInput", () => {
  it("non-array input errors, empty array accepted", () => {
    expect(() => normalizePersonsInput({})).toThrow();
    expect(normalizePersonsInput([])).toEqual([]);
  });

  it("relation to a non-victim person errors", () => {
    expect(() =>
      normalizePersonsInput([
        { id: "t1", name: "Witness", type: "witness" },
        { id: "s1", name: "Suspect", type: "suspect", relatedVictimId: "t1" },
      ]),
    ).toThrow();
  });

  it("relation to a person not in the array errors", () => {
    expect(() =>
      normalizePersonsInput([
        { id: "s1", name: "Suspect", type: "suspect", relatedVictimId: "missing" },
      ]),
    ).toThrow();
  });

  it("cannot relate to an unidentified victim", () => {
    expect(() =>
      normalizePersonsInput([
        { name: "Victim", type: "victim" },
        { id: "s1", name: "Suspect", type: "suspect", relatedVictimId: "missing" },
      ]),
    ).toThrow();
  });

  it("duplicate defined person id errors", () => {
    expect(() =>
      normalizePersonsInput([
        { id: "m1", name: "Victim", type: "victim" },
        { id: "m1", name: "Other", type: "witness" },
      ]),
    ).toThrow(/duplicate person\.id/);
  });

  it("relation to a client-id victim in the same array accepted (victim may come later)", () => {
    const persons = normalizePersonsInput([
      {
        id: "s1",
        name: "Suspect",
        type: "suspect",
        relatedVictimId: "m1",
        relationship: "neighbor",
      },
      { id: "m1", name: "Victim", type: "victim" },
    ]);
    expect(persons[0].relatedVictimId).toBe("m1");
    expect(persons[0].relationship).toBe("neighbor");
  });
});

describe("validateCaseInput persons", () => {
  it("normalizes the persons array, rejects invalid relations", () => {
    const out = validateCaseInput({
      summary: "case",
      persons: [{ id: "m1", name: "Victim", type: "victim" }],
    });
    expect(out.persons).toHaveLength(1);
    expect(out.persons?.[0]).toMatchObject({ id: "m1", type: "victim" });
    expect(() =>
      validateCaseInput({
        summary: "case",
        persons: [{ name: "T", type: "witness", relatedVictimId: "missing" }],
      }),
    ).toThrow();
    expect(validateCaseInput({ summary: "case" }).persons).toBeUndefined();
  });
});

describe("insertCase persons (two-phase)", () => {
  beforeEach(() => {
    process.env.TRACE_DB_PATH = ":memory:";
    closeDb();
    initDb();
  });

  it("writes related persons to case_persons even when the victim comes later in the array", () => {
    const rec = insertCase({
      summary: "case with person",
      persons: normalizePersonsInput([
        {
          id: "s1",
          name: "Suspect",
          type: "suspect",
          relatedVictimId: "m1",
          relationship: "neighbor",
        },
        { id: "m1", name: "Victim", type: "victim", unidentified: false },
        { name: "Nameless", type: "witness", unidentified: true },
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
      relationship: "neighbor",
    });
    expect(rows[1]).toMatchObject({ id: "m1", type: "victim", relatedVictimId: null });
    expect(rows[2].id).toBeTruthy();
    expect(rows[2].id).not.toBe("s1");
    expect(rows[2]).toMatchObject({ name: "Nameless", unidentified: 1 });
  });
});
