import { describe, expect, it } from "vitest";
import {
  normalizeEvidenceInput,
  toEvidenceResponse,
} from "../lib/evidences";

describe("normalizeEvidenceInput", () => {
  it("başlık + not geçerlidir", () => {
    expect(
      normalizeEvidenceInput({ title: " Kovan ", note: " yerde bulundu " }),
    ).toEqual({ title: "Kovan", note: "yerde bulundu" });
  });

  it("başlık zorunludur", () => {
    expect(() => normalizeEvidenceInput({ note: "not" })).toThrow(/title/);
    expect(() =>
      normalizeEvidenceInput({ title: "  ", note: "not" }),
    ).toThrow(/title/);
  });

  it("görsel, ses ya da nottan en az biri zorunludur", () => {
    expect(() => normalizeEvidenceInput({ title: "Delil" })).toThrow(
      /at least one/,
    );
    expect(
      normalizeEvidenceInput({ title: "Delil", hasImage: true }),
    ).toMatchObject({ title: "Delil" });
    expect(
      normalizeEvidenceInput({ title: "Delil", hasAudio: true }),
    ).toMatchObject({ title: "Delil" });
  });
});

describe("toEvidenceResponse", () => {
  it("yeni alanları taşır", () => {
    expect(
      toEvidenceResponse({
        id: "e1",
        caseId: "c1",
        type: "evidence",
        title: "Bıçak",
        note: "not",
        imageFile: "a.jpg",
        audioFile: "b.mp3",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual({
      id: "e1",
      caseId: "c1",
      type: "evidence",
      title: "Bıçak",
      note: "not",
      imageFile: "a.jpg",
      audioFile: "b.mp3",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("eski kayıtlarda başlık türden türetilir", () => {
    expect(
      toEvidenceResponse({
        id: "e2",
        caseId: "c1",
        type: "transcript",
        note: "metin",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("İfade");
    expect(
      toEvidenceResponse({
        id: "e3",
        caseId: "c1",
        type: "photo-marking",
        note: "{}",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("Fotoğraf");
    expect(
      toEvidenceResponse({
        id: "e4",
        caseId: "c1",
        type: "kovan",
        note: "9mm",
        createdAt: "2026-01-01T00:00:00.000Z",
      }).title,
    ).toBe("kovan");
  });
});
