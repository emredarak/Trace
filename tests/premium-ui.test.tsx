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

  it("drawer echoes the clicked row caseNo", async () => {
    const longSummary = "lorem-ipsum-dolor-sit-amet-consectetur-adipiscing-elit-".repeat(4); // ~200 chars, no spaces
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [
      { id: "a", caseNo: "TR-0001", summary: "open job one", status: "open", createdAt: "2026-10-29T00:00:00.000Z" },
      { id: "b", caseNo: "TR-0002", summary: longSummary, status: "open", createdAt: "2026-10-28T00:00:00.000Z" },
    ]}));
    window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;
    render(<Home />);
    const rows = await screen.findAllByRole("button", { name: /TR-/ });
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[1]);
    expect((await screen.findByTestId("selected-title")).textContent).toContain("Selected: TR-0002");
    // selected row keeps the long summary contained (no single-line blowout)
    const selectedRow = document.querySelector(".case-row.selected");
    expect(selectedRow).toBeTruthy();
    const summary = selectedRow?.querySelector(".case-summary");
    expect(summary).toBeTruthy();
    expect(summary?.textContent).toContain(longSummary.slice(0, 110));
    // drawer re-triggers its pulse on selection change
    expect(document.querySelector(".drawer-pulse")).toBeTruthy();
  });
});
