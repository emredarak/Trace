import { describe, expect, it } from "vitest";
import {
  normalizeEvidenceInput,
  toEvidenceResponse,
} from "../lib/evidences";

describe("normalizeEvidenceInput", () => {
  it("title + note is valid", () => {
    expect(
      normalizeEvidenceInput({ title: " Casing ", note: " found at the scene " }),
    ).toEqual({ title: "Casing", note: "found at the scene" });
  });

  it("title is required", () => {
    expect(() => normalizeEvidenceInput({ note: "note" })).toThrow(/title/);
    expect(() =>
      normalizeEvidenceInput({ title: "  ", note: "note" }),
    ).toThrow(/title/);
  });

  it("at least one of image, audio, or note is required", () => {
    expect(() => normalizeEvidenceInput({ title: "Evidence" })).toThrow(
      /at least one/,
    );
    expect(
      normalizeEvidenceInput({ title: "Evidence", hasImage: true }),
    ).toMatchObject({ title: "Evidence" });
    expect(
      normalizeEvidenceInput({ title: "Evidence", hasAudio: true }),
    ).toMatchObject({ title: "Evidence" });
  });
});

describe("toEvidenceResponse", () => {
  it("carries the new fields", () => {
    expect(
      toEvidenceResponse({
        id: "e1",
        caseId: "c1",
        type: "evidence",
        title: "Knife",
        note: "note",
        imageFile: "a.jpg",
        audioFile: "b.mp3",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      id: "e1",
      caseId: "c1",
      type: "evidence",
      title: "Knife",
      note: "note",
      imageFile: "a.jpg",
      audioFile: "b.mp3",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("derives the title from the type for legacy records", () => {
    expect(
      toEvidenceResponse({
        id: "e2",
        caseId: "c1",
        type: "transcript",
        note: "text",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("Statement");
    expect(
      toEvidenceResponse({
        id: "e3",
        caseId: "c1",
        type: "photo-marking",
        note: "{}",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("Photo");
    expect(
      toEvidenceResponse({
        id: "e4",
        caseId: "c1",
        type: "casing",
        note: "9mm",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("casing");
  });
});
