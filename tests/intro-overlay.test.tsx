// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { IntroOverlay } from "../app/components/intro-overlay";

const { mockPathname } = vi.hoisted(() => ({ mockPathname: { value: "/" } }));
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname.value }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("IntroOverlay", () => {
  it("shows on every homepage load", async () => {
    mockPathname.value = "/";
    render(<IntroOverlay />);
    expect(await screen.findByTestId("intro-overlay")).toBeTruthy();
  });
  it("stays hidden off the homepage", () => {
    mockPathname.value = "/cases/case-1";
    const { queryByTestId } = render(<IntroOverlay />);
    expect(queryByTestId("intro-overlay")).toBeNull();
    mockPathname.value = "/";
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
    render(<IntroOverlay />);
    expect(await screen.findByTestId("intro-overlay")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("intro-overlay")).toBeNull(), { timeout: 1500 });
  });
});
