// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import LocationPicker from "../app/components/location-picker";
import type { CaseLocationDraft } from "../lib/locations";

vi.mock("../app/components/map-picker", () => ({
  default: ({
    pick,
    onPick,
  }: {
    pick?: { latitude: number; longitude: number } | null;
    onPick?: (p: { latitude: number; longitude: number }) => void;
  }) => (
    <div>
      <span>
        {pick ? `pin:${pick.latitude},${pick.longitude}` : "pin:none"}
      </span>
      <button
        type="button"
        onClick={() => onPick?.({ latitude: 40.1, longitude: 29.2 })}
      >
        Select map point
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubGeolocation(impl: {
  getCurrentPosition: (
    ok: (p: { coords: { latitude: number; longitude: number } }) => void,
    err?: (e: { message: string }) => void,
  ) => void;
}) {
  Object.defineProperty(navigator, "geolocation", {
    value: impl,
    configurable: true,
  });
}

describe("LocationPicker", () => {
  it("shows error when title empty and moves draft on confirm when filled", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    expect(
      screen.getByRole("dialog", { name: "Select Location" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));
    expect(screen.getByRole("alert").textContent).toMatch(/location title/i);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "Under the bridge" },
    });
    fireEvent.change(screen.getByLabelText("Location Note"), {
      target: { value: "evidence found" },
    });
    fireEvent.change(screen.getByLabelText(/Priority/), {
      target: { value: "critical" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.title).toBe("Under the bridge");
    expect(draft.note).toBe("evidence found");
    expect(draft.kind).toBe("related");
    expect(draft.priority).toBe("critical");
    expect(typeof draft.id).toBe("string");
    expect(draft.id.length).toBeGreaterThan(0);
  });

  it("priority only visible when Related selected", () => {
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(screen.getByLabelText(/Priority/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Crime Scene"));
    expect(screen.queryByLabelText(/Priority/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Related Location"));
    expect(screen.getByLabelText(/Priority/)).toBeTruthy();
  });

  it("crime-scene selection writes null priority to draft", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "Incident point" },
    });
    fireEvent.click(screen.getByLabelText("Crime Scene"));
    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.kind).toBe("crime-scene");
    expect(draft.priority).toBeNull();
  });

  it("clicked address result becomes draft coordinates, no error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { display_name: "Test Address, Ankara", lat: "39.93", lon: "32.85" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "Searched place" },
    });
    fireEvent.change(screen.getByLabelText("Location Note"), {
      target: { value: "note preserved" },
    });
    fireEvent.change(screen.getByLabelText(/address/i), {
      target: { value: "Test Address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("accept-language=en");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=5");

    fireEvent.click(
      await screen.findByRole("button", { name: /Test Address, Ankara/ }),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeCloseTo(39.93);
    expect(draft.longitude).toBeCloseTo(32.85);
    expect(draft.title).toBe("Searched place");
  });

  it("no address result shows error and keeps title/note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "My title" },
    });
    fireEvent.change(screen.getByLabelText("Location Note"), {
      target: { value: "My note" },
    });
    fireEvent.change(screen.getByLabelText(/address/i), {
      target: { value: "nonexistent place" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /address not found/i,
    );
    expect(
      (screen.getByLabelText(/Location Title/) as HTMLInputElement).value,
    ).toBe("My title");
    expect((screen.getByLabelText("Location Note") as HTMLInputElement).value).toBe(
      "My note",
    );
  });

  it("address search network error shows error and keeps title/note", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no network")));
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "My title" },
    });
    fireEvent.change(screen.getByLabelText("Location Note"), {
      target: { value: "My note" },
    });
    fireEvent.change(screen.getByLabelText(/address/i), {
      target: { value: "somewhere" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /could not search the address/i,
    );
    expect(
      (screen.getByLabelText(/Location Title/) as HTMLInputElement).value,
    ).toBe("My title");
    expect((screen.getByLabelText("Location Note") as HTMLInputElement).value).toBe(
      "My note",
    );
  });

  it("Go to My Location success takes coordinates", () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({ coords: { latitude: 41.02, longitude: 28.97 } }),
    });
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "GPS point" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Go to My Location" }));
    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeCloseTo(41.02);
    expect(draft.longitude).toBeCloseTo(28.97);
  });

  it("Go to My Location denial shows readable error", () => {
    stubGeolocation({
      getCurrentPosition: (_ok, err) => err?.({ message: "denied" }),
    });
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to My Location" }));
    expect(screen.getByRole("alert").textContent).toMatch(/could not get your location/i);
  });

  it("cleared map selection saves without coordinates", () => {
    const onConfirm = vi.fn();
    render(
      <LocationPicker initial={null} onClose={vi.fn()} onConfirm={onConfirm} />,
    );
    fireEvent.change(screen.getByLabelText(/Location Title/), {
      target: { value: "Map point" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Select map point" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Clear map selection" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use This Location" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.latitude).toBeUndefined();
    expect(draft.longitude).toBeUndefined();
  });

  it("edit mode prefills fields and Save returns same id", () => {
    const onConfirm = vi.fn();
    const initial: CaseLocationDraft = {
      id: "loc-1",
      title: "Old title",
      note: "old note",
      kind: "related",
      priority: "routine",
      latitude: 39.9,
      longitude: 32.8,
    };
    render(
      <LocationPicker
        initial={initial}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Edit Location" })).toBeTruthy();
    expect(
      (screen.getByLabelText(/Location Title/) as HTMLInputElement).value,
    ).toBe("Old title");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const draft = onConfirm.mock.calls[0][0] as CaseLocationDraft;
    expect(draft.id).toBe("loc-1");
    expect(draft.priority).toBe("routine");
    expect(draft.latitude).toBeCloseTo(39.9);
  });

  it("Cancel calls onClose", () => {
    const onClose = vi.fn();
    render(
      <LocationPicker initial={null} onClose={onClose} onConfirm={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
