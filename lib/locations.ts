export type LocationKind = "crime-scene" | "related";
export type LocationPriority = "critical" | "important" | "routine";

export interface LocationLike {
  kind?: LocationKind | string | null;
  priority?: LocationPriority | string | null;
}

export interface CaseLocationDraft {
  id: string;
  title: string;
  note: string;
  kind: LocationKind;
  priority: LocationPriority | null;
  latitude?: number;
  longitude?: number;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface CoordLike {
  latitude?: number | null;
  longitude?: number | null;
}

const COLORS: Record<string, { pin: string; badgeFg: string }> = {
  "crime-scene": { pin: "#C00000", badgeFg: "#FFFFFF" },
  critical: { pin: "#B34700", badgeFg: "#FFFFFF" },
  important: { pin: "#FFD400", badgeFg: "#000000" },
  routine: { pin: "#0050A0", badgeFg: "#FFFFFF" },
  untagged: { pin: "#5A5A5A", badgeFg: "#FFFFFF" },
};

function colorKey(loc: LocationLike): string {
  if (loc.kind === "crime-scene") return "crime-scene";
  if (loc.priority === "critical" || loc.priority === "important" || loc.priority === "routine") {
    return loc.priority;
  }
  return "untagged";
}

export function locationColor(loc: LocationLike): {
  pin: string;
  badgeBg: string;
  badgeFg: string;
} {
  const c = COLORS[colorKey(loc)];
  return { pin: c.pin, badgeBg: c.pin, badgeFg: c.badgeFg };
}

export function locationLabel(loc: LocationLike): string {
  if (loc.kind === "crime-scene") return "Crime Scene";
  switch (loc.priority) {
    case "critical":
      return "Critical";
    case "important":
      return "Important";
    case "routine":
      return "Routine";
    default:
      return "Related Location";
  }
}

function sortKey(loc: LocationLike): number {
  if (loc.kind === "crime-scene") return 0;
  switch (loc.priority) {
    case "critical":
      return 1;
    case "important":
      return 2;
    case "routine":
      return 3;
    default:
      return 4;
  }
}

export function sortLocations<T extends LocationLike>(locs: T[]): T[] {
  return locs
    .map((loc, index) => ({ loc, index }))
    .sort((a, b) => sortKey(a.loc) - sortKey(b.loc) || a.index - b.index)
    .map(({ loc }) => loc);
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  const roundedMeters = Math.round(meters);
  if (roundedMeters < 1000) return `${roundedMeters} m`;
  const kmRounded = Math.round((meters / 1000) * 10) / 10;
  if (kmRounded < 10) {
    return `${kmRounded.toFixed(1).replace(".", ",")} km`;
  }
  return `${Math.round(kmRounded)} km`;
}

export function distancePairs(
  locs: CoordLike[],
): { aIndex: number; bIndex: number; meters: number; label: string }[] {
  const pairs: { aIndex: number; bIndex: number; meters: number; label: string }[] = [];
  for (let i = 0; i < locs.length; i++) {
    const a = locs[i];
    if (typeof a.latitude !== "number" || typeof a.longitude !== "number") continue;
    for (let j = i + 1; j < locs.length; j++) {
      const b = locs[j];
      if (typeof b.latitude !== "number" || typeof b.longitude !== "number") continue;
      const meters = haversineMeters(
        { latitude: a.latitude, longitude: a.longitude },
        { latitude: b.latitude, longitude: b.longitude },
      );
      pairs.push({ aIndex: i, bIndex: j, meters, label: formatDistance(meters) });
    }
  }
  return pairs;
}
