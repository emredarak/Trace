"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import {
  distancePairs,
  locationColor,
  locationLabel,
  type LocationKind,
  type LocationPriority,
} from "../../lib/locations";

export interface MapPoint {
  latitude: number;
  longitude: number;
  title?: string;
  note?: string;
  kind?: LocationKind | string | null;
  priority?: LocationPriority | string | null;
}

interface MapPickerProps {
  points?: MapPoint[];
  pick?: MapPoint | null;
  onPick?: (point: MapPoint) => void;
  readOnly?: boolean;
  height?: number;
}

const DEFAULT_CENTER: MapPoint = { latitude: 39.93, longitude: 32.85 };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function pointInfoHtml(p: MapPoint): string {
  const color = locationColor(p);
  const title = p.title?.trim() ? p.title : "Konum";
  const lines = [
    `<strong>${escapeHtml(title)}</strong>`,
    `<span style="background:${color.badgeBg};color:${color.badgeFg};padding:0.1rem 0.45rem;border-radius:0.4rem;">${escapeHtml(locationLabel(p))}</span>`,
  ];
  if (p.note?.trim()) lines.push(escapeHtml(p.note));
  lines.push(`(${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)})`);
  return lines.join("<br/>");
}

const MAP_CSS = `
.leaflet-tooltip.trace-map-tooltip,
.leaflet-tooltip.trace-distance-label {
  background: #ffffff;
  color: #111111;
  border: 1px solid #111111;
  font-size: 16px;
  line-height: 1.5;
  opacity: 1;
  box-shadow: none;
}
.leaflet-tooltip.trace-distance-label {
  font-weight: 600;
  padding: 0.15rem 0.5rem;
}
.leaflet-popup.trace-map-popup .leaflet-popup-content-wrapper {
  background: #ffffff;
  color: #111111;
  border: 1px solid #111111;
  box-shadow: none;
}
.leaflet-popup.trace-map-popup .leaflet-popup-content {
  font-size: 16px;
  line-height: 1.5;
  color: #111111;
}
.leaflet-popup.trace-map-popup .leaflet-popup-tip {
  background: #ffffff;
  border: 1px solid #111111;
}
`;

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
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  // Leaflet tipleri dinamik importtan gelir; somut tipler kurulum aninda bilinir.
  const mapRef = useRef<{ remove: () => void } | null>(null);
  const layerGroupRef = useRef<ReturnType<
    (typeof import("leaflet"))["layerGroup"]
  > | null>(null);

  // Haritayi yalnizca bileşen kaldirilirken yok et.
  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function setup() {
      try {
        const L = await import("leaflet");
        if (cancelled || !divRef.current) return;

        if (!mapRef.current) {
          const leafletMap = L.map(divRef.current).setView(
            [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude],
            13,
          );
          mapRef.current = leafletMap;
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
          }).addTo(leafletMap);
          layerGroupRef.current = L.layerGroup().addTo(leafletMap);
          leafletMap.on(
            "click",
            (e: { latlng: { lat: number; lng: number } }) => {
              if (readOnlyRef.current) return;
              onPickRef.current?.({
                latitude: e.latlng.lat,
                longitude: e.latlng.lng,
              });
            },
          );
        }

        const leafletMap = mapRef.current as ReturnType<typeof L.map>;
        const group = layerGroupRef.current;
        if (!group) return;
        group.clearLayers();

        for (const p of points) {
          const color = locationColor(p);
          const marker = L.circleMarker([p.latitude, p.longitude], {
            radius: 8,
            color: color.pin,
            fillColor: color.pin,
            fillOpacity: 0.9,
            weight: 2,
          }).addTo(group);
          marker.bindTooltip(pointInfoHtml(p), {
            className: "trace-map-tooltip",
            direction: "top",
          });
          marker.bindPopup(pointInfoHtml(p), {
            className: "trace-map-popup",
          });
        }

        for (const pair of distancePairs(points)) {
          const a = points[pair.aIndex];
          const b = points[pair.bIndex];
          if (!a || !b) continue;
          L.polyline(
            [
              [a.latitude, a.longitude],
              [b.latitude, b.longitude],
            ],
            { color: "#333333", weight: 2, dashArray: "6 6", opacity: 1 },
          ).addTo(group);
          L.tooltip({
            permanent: true,
            direction: "center",
            className: "trace-distance-label",
            interactive: false,
          })
            .setLatLng([
              (a.latitude + b.latitude) / 2,
              (a.longitude + b.longitude) / 2,
            ])
            .setContent(pair.label)
            .addTo(group);
        }

        if (pick) {
          const color = locationColor(pick);
          const pickIcon = L.divIcon({
            className: "trace-pick-pin",
            html: `<div style="width:22px;height:22px;border-radius:50%;background:${color.pin};border:3px solid #ffffff;box-shadow:0 0 0 1px #111111;"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          const pickMarker = L.marker([pick.latitude, pick.longitude], {
            draggable: !readOnly,
            icon: pickIcon,
          }).addTo(group);
          pickMarker.bindTooltip(pointInfoHtml(pick), {
            className: "trace-map-tooltip",
            direction: "top",
          });
          pickMarker.bindPopup(pointInfoHtml(pick), {
            className: "trace-map-popup",
          });
          pickMarker.on("dragend", () => {
            const ll = pickMarker.getLatLng();
            onPickRef.current?.({ latitude: ll.lat, longitude: ll.lng });
          });
        }

        if (pick) {
          leafletMap.setView(
            [pick.latitude, pick.longitude],
            Math.max(leafletMap.getZoom(), 15),
          );
        } else if (points.length === 1) {
          leafletMap.setView([points[0].latitude, points[0].longitude], 15);
        } else if (points.length > 1) {
          leafletMap.fitBounds(
            L.latLngBounds(
              points.map(
                (p) => [p.latitude, p.longitude] as [number, number],
              ),
            ),
            { padding: [24, 24] },
          );
        } else {
          leafletMap.setView(
            [DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude],
            13,
          );
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void setup();
    return () => {
      cancelled = true;
    };
  }, [points, pick, readOnly]);

  if (failed) {
    return <p>Harita yüklenemedi (çevrimdışı olabilirsiniz); metin konumu kullanın.</p>;
  }
  return (
    <>
      <style>{MAP_CSS}</style>
      <div ref={divRef} style={{ height, borderRadius: "0.6rem" }} />
    </>
  );
}
