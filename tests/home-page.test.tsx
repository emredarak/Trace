// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Home from "../app/page";

afterEach(() => cleanup());

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Home page case lists", () => {
  it("shows open and closed cases in separate sections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { id: "a", caseNo: "TR-0001", summary: "open job", status: "open" },
          { id: "b", caseNo: "TR-0002", summary: "closed job", status: "closed" },
        ],
      }),
    );
    render(<Home />);

    expect(await screen.findByText(/Active Cases \(1\)/)).toBeTruthy();
    expect(await screen.findByText(/Past Cases \(1\)/)).toBeTruthy();
    expect(screen.getByText(/TR-0001/)).toBeTruthy();
    expect(screen.getByText(/TR-0002/)).toBeTruthy();
  });

  it("shows warning on server error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );
    render(<Home />);

    expect(await screen.findByText(/could not load cases/i)).toBeTruthy();
  });
});
