import { describe, expect, it, vi } from "vitest";
import { fieldBrief } from "../lib/field-brief";

const THREE = [
  { type: "transcript", note: "I saw the white car in front of the night market" },
  { type: "transcript", note: "I took the plate, the driver fled fast" },
  { type: "transcript", note: "the security camera faced the street" },
] as Parameters<typeof fieldBrief>[0];

describe("fieldBrief", () => {
  it("returns a one-sentence summary from 3 resolved inputs", async () => {
    const summarize = vi.fn(async (_prompt: string) => "The suspect fled in the white car.");
    const out = await fieldBrief(THREE, { summarize });
    expect(out).toBe("The suspect fled in the white car.");
    // Single call, all three resolutions combined in the prompt.
    expect(summarize).toHaveBeenCalledTimes(1);
    const prompt = String(summarize.mock.calls[0]?.[0]);
    for (const e of THREE) expect(prompt).toContain(e.note!);
  });

  it("returns empty for empty input without calling the client", async () => {
    const summarize = vi.fn(async (_prompt: string) => "asla");
    await expect(fieldBrief([], { summarize })).resolves.toBe("");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("ignores non-transcript inputs (photo markings)", async () => {
    const summarize = vi.fn(async (_prompt: string) => "asla");
    const entries = [
      { type: "photo-marking", note: '{"marks":[{"x":1,"y":2}]}' },
      { type: "note", note: "" },
    ] as Parameters<typeof fieldBrief>[0];
    await expect(fieldBrief(entries, { summarize })).resolves.toBe("");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("skips on client error: returns empty, does not throw", async () => {
    const out = await fieldBrief(THREE, {
      summarize: async () => {
        throw new Error("service crashed");
      },
    });
    expect(out).toBe("");
  });
});
