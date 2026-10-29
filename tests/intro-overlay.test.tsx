// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { IntroOverlay } from "../app/components/intro-overlay";

afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe("IntroOverlay", () => {
  it("shows once per session then hides", async () => {
    render(<IntroOverlay />);
    expect(await screen.findByTestId("intro-overlay")).toBeTruthy();
  });
  it("does not render when already seen", () => {
    sessionStorage.setItem("trace-intro-seen", "1");
    const { queryByTestId } = render(<IntroOverlay />);
    expect(queryByTestId("intro-overlay")).toBeNull();
  });
  it("respects reduced motion", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { queryByTestId } = render(<IntroOverlay />);
    expect(queryByTestId("intro-overlay")).toBeNull();
  });
  it("skip button and Escape close it", async () => {
    render(<IntroOverlay />);
    fireEvent.click(await screen.findByTestId("intro-skip"));
    expect(screen.getByTestId("intro-overlay").className).toContain("is-leaving");
    await waitFor(() => expect(screen.queryByTestId("intro-overlay")).toBeNull(), { timeout: 1500 });
    expect(sessionStorage.getItem("trace-intro-seen")).toBe("1");
    sessionStorage.clear();
    render(<IntroOverlay />);
    expect(await screen.findByTestId("intro-overlay")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("intro-overlay")).toBeNull(), { timeout: 1500 });
  });
});
