"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  latitude: number;
  longitude: number;
  note?: string;
}

interface MapPickerProps {
  points?: MapPoint[];
  pick?: MapPoint | null;
  onPick?: (point: MapPoint) => void;
  readOnly?: boolean;
  height?: number;
}

const DEFAULT_CENTER: MapPoint = { latitude: 39.93, longitude: 32.85 };

export default function MapPicker({
  points = [],
  pick = null,
  onPick,
  readOnly = false,
  height = 260,
}: MapPickerProps) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    let cancelled = false;
    let map: { remove: () => void } | null = null;
    async function setup() {
      try {
        const L = await import("leaflet");
        if (cancelled || !divRef.current) return;
        const center =
          pick ?? points[0] ?? DEFAULT_CENTER;
        const leafletMap = L.map(divRef.current).setView(
          [center.latitude, center.longitude],
          13,
        );
        map = leafletMap;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(leafletMap);
        for (const p of points) {
          L.circleMarker([p.latitude, p.longitude], { radius: 8 }).addTo(
            leafletMap,
          );
        }
        if (!readOnly) {
          if (pick) {
            L.circleMarker([pick.latitude, pick.longitude], {
              radius: 10,
            }).addTo(leafletMap);
          }
          leafletMap.on("click", (e: { latlng: { lat: number; lng: number } }) => {
            onPickRef.current?.({
              latitude: e.latlng.lat,
              longitude: e.latlng.lng,
            });
          });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void setup();
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  if (failed) {
    return <p>Harita yüklenemedi (çevrimdışı olabilirsiniz); metin konumu kullanın.</p>;
  }
  return <div ref={divRef} style={{ height, borderRadius: "0.6rem" }} />;
}
