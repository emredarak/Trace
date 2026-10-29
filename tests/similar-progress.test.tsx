// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  SimilarSearchProgress,
  type StageView,
} from "../app/components/similar-search-progress";
import { readSearchEvents } from "../lib/search-stream";
import type { SearchProgressEvent } from "../lib/search-estimate";

afterEach(() => cleanup());

const STAGES: StageView[] = [
  {
    key: "enrichment",
    label: "Enrichment",
    owner: "Muse Voice Transcribe · SAM 3.1",
    why: "Audio becomes searchable text and images gain object labels.",
    status: "done",
    durationMs: 3000,
    details: ["1 audio transcribed · 1 image marked"],
  },
  {
    key: "dossiers",
    label: "Case files",
    owner: "Muse Glimmer",
    why: "Each case is compiled into one comparable file.",
    status: "done",
    durationMs: 6000,
    details: ["2 of 18 files updated · 16 reused"],
  },
  {
    key: "candidates",
    label: "Candidates",
    owner: "Local code",
    why: "Five channels nominate up to 20 candidates.",
    status: "done",
    durationMs: 1000,
    details: ["7 candidates"],
  },
  {
    key: "scoring",
    label: "Scoring",
    owner: "Muse Spark Open",
    why: "Candidate files are compared in a single call.",
    status: "active",
    activeElapsedMs: 32_000,
    details: ["3 scored by Spark · 2 from cache · 3 images attached"],
  },
  {
    key: "verification",
    label: "Verification & ranking",
    owner: "Local code",
    why: "Quoted evidence must exist in the source records.",
    status: "pending",
    details: [],
  },
];

describe("SimilarSearchProgress", () => {
  it("shows the big elapsed clock, estimate range, stages and active details", () => {
    render(
      <SimilarSearchProgress
        stages={STAGES}
        elapsedMs={42_000}
        estimate={{ lowMs: 20_000, highMs: 40_000 }}
        estimateOverrun={false}
      />,
    );
    expect(screen.getByText("00:42")).toBeTruthy();
    expect(screen.getByText(/Estimated remaining ~20–40s/)).toBeTruthy();
    expect(screen.getByText(/Muse Spark Open/)).toBeTruthy();
    // Active stage starts expanded.
    expect(screen.getByText(/3 scored by Spark/)).toBeTruthy();
    // Completed stage details stay hidden until expanded.
    expect(screen.queryByText(/2 of 18 files updated/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Case files/ }));
    expect(screen.getByText(/2 of 18 files updated/)).toBeTruthy();
  });

  it("shows the taking-longer warning instead of an estimate when overrun", () => {
    render(
      <SimilarSearchProgress
        stages={STAGES}
        elapsedMs={42_000}
        estimate={null}
        estimateOverrun
      />,
    );
    expect(screen.getByText(/Taking longer than expected/)).toBeTruthy();
    expect(screen.queryByText(/Estimated remaining/)).toBeNull();
  });

  it("hides the estimate entirely when there is not enough history", () => {
    render(
      <SimilarSearchProgress stages={STAGES} elapsedMs={1000} estimate={null} estimateOverrun={false} />,
    );
    expect(screen.queryByText(/Estimated remaining/)).toBeNull();
    expect(screen.queryByText(/Taking longer/)).toBeNull();
  });

  it("labels skipped stages and formats hours in the clock", () => {
    const stages = STAGES.map((s) =>
      s.key === "enrichment" ? { ...s, status: "skipped" as const, durationMs: 0 } : s,
    );
    render(
      <SimilarSearchProgress stages={stages} elapsedMs={3_661_000} estimate={null} estimateOverrun={false} />,
    );
    expect(screen.getByText("1:01:01")).toBeTruthy();
    expect(screen.getByText(/Skipped/)).toBeTruthy();
  });
});

describe("readSearchEvents", () => {
  function ndjsonResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
        else controller.close();
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  it("reassembles lines split across chunks and resolves with the result payload", async () => {
    const events: SearchProgressEvent[] = [];
    const res = ndjsonResponse([
      '{"seq":1,"elapsedMs":0,"type":"star',
      'ted"}\n{"seq":2,"elapsedMs":5,"type":"result","results":[],"fresh":true,"limit":5,"pendingEnrichment":false}\n',
    ]);
    const payload = await readSearchEvents(res, (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(["started", "result"]);
    expect(payload).toEqual({ results: [], fresh: true, limit: 5, pendingEnrichment: false });
  });

  it("rejects when the stream ends without a result event", async () => {
    const events: SearchProgressEvent[] = [];
    const res = ndjsonResponse(['{"seq":1,"elapsedMs":0,"type":"started"}\n']);
    await expect(readSearchEvents(res, (e) => events.push(e))).rejects.toThrow();
  });

  it("rejects on an error event", async () => {
    const res = ndjsonResponse([
      '{"seq":1,"elapsedMs":0,"type":"started"}\n{"seq":2,"elapsedMs":5,"type":"error","error":"similar_search_failed"}\n',
    ]);
    await expect(readSearchEvents(res, () => {})).rejects.toThrow();
  });
});
