// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import Home from "../app/page";
afterEach(() => cleanup());
describe("premium readability", () => {
  it("row hover exposes preview hint and pressed state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { id: "a", caseNo: "TR-0001", summary: "open job", status: "open", createdAt: "2026-10-29T00:00:00.000Z" },
    ]}));
    render(<Home />);
    const row = await screen.findByRole("button", { name: /TR-0001/ });
    fireEvent.click(row);
    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".preview-hint")).toBeTruthy();
  });
});
