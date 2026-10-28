import { afterEach, describe, expect, it } from "vitest";
import { checkPasscode } from "../lib/demo-auth";

describe("checkPasscode", () => {
  const prev = process.env.DEMO_PASSCODE;

  afterEach(() => {
    if (prev === undefined) delete process.env.DEMO_PASSCODE;
    else process.env.DEMO_PASSCODE = prev;
  });

  it("returns true for the correct passcode", () => {
    process.env.DEMO_PASSCODE = "demo-secret";
    expect(checkPasscode("demo-secret")).toBe(true);
  });

  it("returns false for the wrong passcode", () => {
    process.env.DEMO_PASSCODE = "demo-secret";
    expect(checkPasscode("wrong")).toBe(false);
  });

  it("returns false when passcode is undefined", () => {
    delete process.env.DEMO_PASSCODE;
    expect(checkPasscode("demo-secret")).toBe(false);
  });
});
