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
  it("1000 m altını metre olarak gösterir", () => {
    expect(formatDistance(850)).toBe("850 m");
  });

  it("1000 m ve üstünü 10 km altında bir ondalıkla km gösterir", () => {
    expect(formatDistance(1240)).toBe("1,2 km");
  });

  it("10 km ve üstünü tam sayı km gösterir", () => {
    expect(formatDistance(12300)).toBe("12 km");
  });
});

describe("haversineMeters", () => {
  it("İstanbul–Ankara arası 350–450 km aralığındadır", () => {
    const meters = haversineMeters(
      { latitude: 41.05, longitude: 28.9 },
      { latitude: 39.9334, longitude: 32.8597 },
    );
    expect(meters).toBeGreaterThan(350_000);
    expect(meters).toBeLessThan(450_000);
  });
});

describe("sortLocations", () => {
  it("Olay Yeri'ni Kritik/Önemli/Rutin/etiketsizin önüne alır", () => {
    const locs = [
      { title: "etiketsiz", kind: "iliskili", priority: null },
      { title: "rutin", kind: "iliskili", priority: "rutin" },
      { title: "olay", kind: "olay-yeri", priority: null },
      { title: "onemli", kind: "iliskili", priority: "onemli" },
      { title: "kritik", kind: "iliskili", priority: "kritik" },
    ] as const;
    expect(sortLocations([...locs]).map((l) => l.title)).toEqual([
      "olay",
      "kritik",
      "onemli",
      "rutin",
      "etiketsiz",
    ]);
  });

  it("aynı grupta giriş sırasını korur", () => {
    const locs = [
      { title: "ilk olay", kind: "olay-yeri", priority: null },
      { title: "ikinci olay", kind: "olay-yeri", priority: null },
    ] as const;
    expect(sortLocations([...locs]).map((l) => l.title)).toEqual([
      "ilk olay",
      "ikinci olay",
    ]);
  });
});

describe("distancePairs", () => {
  it("koordinatsız konumu atlar ve 2 koordinatlı konumda 1 çift döner", () => {
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

  it("3 koordinatlı konumda 3 çift döner ve koordinatsız indeks hiçbir çiftte yer almaz", () => {
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

  it("tüm çiftlerin etiketi formatDistance(meters) ile aynıdır", () => {
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
  it("Olay Yeri için kırmızı pin ve 'Olay Yeri' etiketi döner", () => {
    const loc = { kind: "olay-yeri", priority: null } as const;
    expect(locationColor(loc).pin).toBe("#C00000");
    expect(locationColor(loc).badgeBg).toBe("#C00000");
    expect(locationLabel(loc)).toBe("Olay Yeri");
  });

  it("Önemli için siyah yazılı sarı döner", () => {
    const loc = { kind: "iliskili", priority: "onemli" } as const;
    const color = locationColor(loc);
    expect(color.pin).toBe("#FFD400");
    expect(color.badgeBg).toBe("#FFD400");
    expect(color.badgeFg).toBe("#000000");
    expect(locationLabel(loc)).toBe("Önemli");
  });

  it("diğer önceliklerin etiketlerini döner", () => {
    expect(locationLabel({ kind: "iliskili", priority: "kritik" })).toBe("Kritik");
    expect(locationLabel({ kind: "iliskili", priority: "rutin" })).toBe("Rutin");
    expect(locationLabel({ kind: "iliskili", priority: null })).toBe(
      "İlişkili Konum",
    );
    expect(locationColor({ kind: "iliskili", priority: "kritik" }).pin).toBe(
      "#B34700",
    );
    expect(locationColor({ kind: "iliskili", priority: "rutin" }).pin).toBe(
      "#0050A0",
    );
    expect(locationColor({ kind: "iliskili", priority: null }).pin).toBe(
      "#5A5A5A",
    );
  });
});

describe("normalizeLocationInput", () => {
  it("kanonik title varsa not = note ?? locationText olur", () => {
    expect(
      normalizeLocationInput({ title: "Ev", locationText: "arka bahçe" }),
    ).toMatchObject({ title: "Ev", note: "arka bahçe", kind: "iliskili", priority: null });
    expect(
      normalizeLocationInput({ title: "Ev", note: "not", locationText: "eski" }),
    ).toMatchObject({ title: "Ev", note: "not" });
  });

  it("title yoksa note başlık olur, locationText not olur", () => {
    expect(
      normalizeLocationInput({ note: "Bulunma noktası", locationText: "dere yatağı" }),
    ).toMatchObject({ title: "Bulunma noktası", note: "dere yatağı" });
  });

  it("yalnız locationText varsa başlık o olur, not boş kalır", () => {
    expect(normalizeLocationInput({ locationText: "köprü altı" })).toMatchObject({
      title: "köprü altı",
      note: null,
    });
  });

  it("yalnız koordinat varsa başlık 'Konum' olur", () => {
    expect(
      normalizeLocationInput({ latitude: 41.01, longitude: 28.97 }),
    ).toMatchObject({ title: "Konum", note: null, latitude: 41.01, longitude: 28.97 });
  });

  it("hiçbir şey yoksa hata verir", () => {
    expect(() => normalizeLocationInput({})).toThrow();
  });

  it("kind varsayılanı iliskili'dir; geçersiz kind hata verir", () => {
    expect(normalizeLocationInput({ title: "x" }).kind).toBe("iliskili");
    expect(() => normalizeLocationInput({ title: "x", kind: "baska" })).toThrow();
  });

  it("Olay Yeri'nde priority null yazılır; geçersiz öncelik hata verir", () => {
    expect(
      normalizeLocationInput({ title: "x", kind: "olay-yeri", priority: "kritik" })
        .priority,
    ).toBeNull();
    expect(
      () => normalizeLocationInput({ title: "x", priority: "baska" }),
    ).toThrow();
  });

  it("koordinatlar birlikte olmalı ve aralık içinde olmalıdır", () => {
    expect(() => normalizeLocationInput({ title: "x", latitude: 41 })).toThrow();
    expect(
      () => normalizeLocationInput({ title: "x", latitude: 91, longitude: 29 }),
    ).toThrow();
    expect(
      () => normalizeLocationInput({ title: "x", latitude: 41, longitude: 181 }),
    ).toThrow();
  });
});
