import { describe, expect, it } from "vitest";
import {
  distancePairs,
  formatDistance,
  haversineMeters,
  locationColor,
  locationLabel,
  sortLocations,
} from "../lib/locations";
import { normalizeLocationInput } from "../lib/case-schema";

describe("formatDistance", () => {
  it("shows values under 1000 m in meters", () => {
    expect(formatDistance(850)).toBe("850 m");
  });

  it("shows 1000 m and above as km with one decimal below 10 km", () => {
    expect(formatDistance(1240)).toBe("1,2 km");
  });

  it("shows 10 km and above as whole-number km", () => {
    expect(formatDistance(12300)).toBe("12 km");
  });

  it("promotes based on the rounded value", () => {
    expect(formatDistance(999.6)).toBe("1,0 km");
    expect(formatDistance(999.4)).toBe("999 m");
    expect(formatDistance(9999)).toBe("10 km");
    expect(formatDistance(9500)).toBe("9,5 km");
  });
});

describe("haversineMeters", () => {
  it("Istanbul-Ankara is in the 350-450 km range", () => {
    const meters = haversineMeters(
      { latitude: 41.05, longitude: 28.9 },
      { latitude: 39.9334, longitude: 32.8597 },
    );
    expect(meters).toBeGreaterThan(350_000);
    expect(meters).toBeLessThan(450_000);
  });
});

describe("sortLocations", () => {
  it("puts Crime Scene ahead of Critical/Important/Routine/untagged", () => {
    const locs = [
      { title: "untagged", kind: "related", priority: null },
      { title: "routine", kind: "related", priority: "routine" },
      { title: "incident", kind: "crime-scene", priority: null },
      { title: "important", kind: "related", priority: "important" },
      { title: "critical", kind: "related", priority: "critical" },
    ] as const;
    expect(sortLocations([...locs]).map((l) => l.title)).toEqual([
      "incident",
      "critical",
      "important",
      "routine",
      "untagged",
    ]);
  });

  it("preserves insertion order within the same group", () => {
    const locs = [
      { title: "first incident", kind: "crime-scene", priority: null },
      { title: "second incident", kind: "crime-scene", priority: null },
    ] as const;
    expect(sortLocations([...locs]).map((l) => l.title)).toEqual([
      "first incident",
      "second incident",
    ]);
  });
});

describe("distancePairs", () => {
  it("skips locations without coordinates; 2 geolocated locations yield 1 pair", () => {
    const pairs = distancePairs([
      { latitude: 41.0082, longitude: 28.9784 },
      { latitude: null, longitude: null },
      { latitude: 39.9334, longitude: 32.8597 },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].aIndex).toBe(0);
    expect(pairs[0].bIndex).toBe(2);
    expect(pairs[0].label).toBe(formatDistance(pairs[0].meters));
  });

  it("3 geolocated locations yield 3 pairs; the coordinate-less index appears in no pair", () => {
    const pairs = distancePairs([
      { latitude: 41.0082, longitude: 28.9784 },
      { latitude: 41.02, longitude: 28.99 },
      { latitude: null, longitude: null },
      { latitude: 39.9334, longitude: 32.8597 },
    ]);
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => [p.aIndex, p.bIndex])).toEqual([
      [0, 1],
      [0, 3],
      [1, 3],
    ]);
    expect(
      pairs.every((p) => p.aIndex !== 2 && p.bIndex !== 2),
    ).toBe(true);
  });

  it("every pair label matches formatDistance(meters)", () => {
    const pairs = distancePairs([
      { latitude: 41.0082, longitude: 28.9784 },
      { latitude: 41.02, longitude: 28.99 },
      { latitude: 39.9334, longitude: 32.8597 },
    ]);
    expect(pairs.length).toBeGreaterThan(0);
    for (const pair of pairs) {
      expect(pair.label).toBe(formatDistance(pair.meters));
    }
  });
});

describe("locationColor / locationLabel", () => {
  it("returns a red pin and 'Crime Scene' label for Crime Scene", () => {
    const loc = { kind: "crime-scene", priority: null } as const;
    expect(locationColor(loc).pin).toBe("#C00000");
    expect(locationColor(loc).badgeBg).toBe("#C00000");
    expect(locationLabel(loc)).toBe("Crime Scene");
  });

  it("returns black-on-yellow for Important", () => {
    const loc = { kind: "related", priority: "important" } as const;
    const color = locationColor(loc);
    expect(color.pin).toBe("#FFD400");
    expect(color.badgeBg).toBe("#FFD400");
    expect(color.badgeFg).toBe("#000000");
    expect(locationLabel(loc)).toBe("Important");
  });

  it("returns the labels of the other priorities", () => {
    expect(locationLabel({ kind: "related", priority: "critical" })).toBe("Critical");
    expect(locationLabel({ kind: "related", priority: "routine" })).toBe("Routine");
    expect(locationLabel({ kind: "related", priority: null })).toBe(
      "Related Location",
    );
    expect(locationColor({ kind: "related", priority: "critical" }).pin).toBe(
      "#B34700",
    );
    expect(locationColor({ kind: "related", priority: "routine" }).pin).toBe(
      "#0050A0",
    );
    expect(locationColor({ kind: "related", priority: null }).pin).toBe(
      "#5A5A5A",
    );
  });
});

describe("normalizeLocationInput", () => {
  it("with canonical title, note = note ?? locationText", () => {
    expect(
      normalizeLocationInput({ title: "House", locationText: "backyard" }),
    ).toMatchObject({ title: "House", note: "backyard", kind: "related", priority: null });
    expect(
      normalizeLocationInput({ title: "House", note: "note", locationText: "old" }),
    ).toMatchObject({ title: "House", note: "note" });
  });

  it("without title, note becomes the title and locationText the note", () => {
    expect(
      normalizeLocationInput({ note: "Discovery site", locationText: "creek bed" }),
    ).toMatchObject({ title: "Discovery site", note: "creek bed" });
  });

  it("with only locationText, it becomes the title and note stays empty", () => {
    expect(normalizeLocationInput({ locationText: "under the bridge" })).toMatchObject({
      title: "under the bridge",
      note: null,
    });
  });

  it("with only coordinates, title becomes 'Location'", () => {
    expect(
      normalizeLocationInput({ latitude: 41.01, longitude: 28.97 }),
    ).toMatchObject({ title: "Location", note: null, latitude: 41.01, longitude: 28.97 });
  });

  it("throws when there is nothing", () => {
    expect(() => normalizeLocationInput({})).toThrow();
  });

  it("kind defaults to related; invalid kind throws", () => {
    expect(normalizeLocationInput({ title: "x" }).kind).toBe("related");
    expect(() => normalizeLocationInput({ title: "x", kind: "other" })).toThrow();
  });

  it("priority is written null for Crime Scene; invalid priority throws", () => {
    expect(
      normalizeLocationInput({ title: "x", kind: "crime-scene", priority: "critical" })
        .priority,
    ).toBeNull();
    expect(
      () => normalizeLocationInput({ title: "x", priority: "other" }),
    ).toThrow();
  });

  it("coordinates must come together and be in range", () => {
    expect(() => normalizeLocationInput({ title: "x", latitude: 41 })).toThrow();
    expect(
      () => normalizeLocationInput({ title: "x", latitude: 91, longitude: 29 }),
    ).toThrow();
    expect(
      () => normalizeLocationInput({ title: "x", latitude: 41, longitude: 181 }),
    ).toThrow();
  });
});
