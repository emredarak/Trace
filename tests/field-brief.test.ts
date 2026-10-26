import { describe, expect, it, vi } from "vitest";
import { fieldBrief } from "../lib/field-brief";

const THREE = [
  { type: "transcript", note: "gece marketin önünde beyaz arabayı gördüm" },
  { type: "transcript", note: "plakayı aldım, sürücü hızla kaçtı" },
  { type: "transcript", note: "güvenlik kamerası sokağa bakıyordu" },
] as Parameters<typeof fieldBrief>[0];

describe("fieldBrief", () => {
  it("3 çözümlü girişten tek cümle özet döner", async () => {
    const summarize = vi.fn(async (_prompt: string) => "Beyaz araçlı şüpheli kaçtı.");
    const out = await fieldBrief(THREE, { summarize });
    expect(out).toBe("Beyaz araçlı şüpheli kaçtı.");
    // Tek çağrı, üç çözüm de istemde birleşti.
    expect(summarize).toHaveBeenCalledTimes(1);
    const prompt = String(summarize.mock.calls[0]?.[0]);
    for (const e of THREE) expect(prompt).toContain(e.note!);
  });

  it("boş girişte boş döner, istemciyi çağırmaz", async () => {
    const summarize = vi.fn(async (_prompt: string) => "asla");
    await expect(fieldBrief([], { summarize })).resolves.toBe("");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("transcript dışı girişler (foto işaretleme) yok sayılır", async () => {
    const summarize = vi.fn(async (_prompt: string) => "asla");
    const entries = [
      { type: "photo-marking", note: '{"marks":[{"x":1,"y":2}]}' },
      { type: "note", note: "" },
    ] as Parameters<typeof fieldBrief>[0];
    await expect(fieldBrief(entries, { summarize })).resolves.toBe("");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("istemci hatasında atlar: boş döner, fırlatmaz", async () => {
    const out = await fieldBrief(THREE, {
      summarize: async () => {
        throw new Error("servis çöktü");
      },
    });
    expect(out).toBe("");
  });
});
