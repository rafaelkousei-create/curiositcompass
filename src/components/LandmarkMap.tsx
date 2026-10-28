import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";

type Point = { lat: number; lng: number };

type Props = {
  current: Point | null;
  landmark: (Point & { name: string }) | null;
  recenterKey?: number;
  bottomPadding?: number;
  places?: (Point & { title: string })[];
  onPick?: (title: string) => void;
};

export function LandmarkMap({ current, landmark, recenterKey = 0, bottomPadding = 330, places = [], onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const currentMarkerRef = useRef<Marker | null>(null);
  const landmarkMarkerRef = useRef<Marker | null>(null);
  const placesLayerRef = useRef<LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const bottomRef = useRef(bottomPadding);
  bottomRef.current = bottomPadding;

  useEffect(() => {
    let disposed = false;

    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
      }).setView(current ? [current.lat, current.lng] : [20, 0], current ? 15 : 3);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
    });

    return () => {
      disposed = true;
      currentMarkerRef.current = null;
      landmarkMarkerRef.current = null;
      placesLayerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let active = true;
    void import("leaflet").then((L) => {
      if (!active || !mapRef.current) return;

      if (current) {
        const icon = L.divIcon({
          className: "wayfarer-marker-shell",
          html: '<span class="wayfarer-marker-current"><span></span></span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        if (currentMarkerRef.current) {
          currentMarkerRef.current.setLatLng([current.lat, current.lng]);
        } else {
          currentMarkerRef.current = L.marker([current.lat, current.lng], { icon })
            .addTo(map)
            .bindTooltip("You are here", { direction: "top", offset: [0, -12] });
        }
      }

      if (landmark) {
        const icon = L.divIcon({
          className: "wayfarer-marker-shell",
          html: '<span class="wayfarer-marker-landmark"></span>',
          iconSize: [34, 42],
          iconAnchor: [17, 40],
          popupAnchor: [0, -42],
        });
        if (landmarkMarkerRef.current) {
          landmarkMarkerRef.current.setLatLng([landmark.lat, landmark.lng]).setIcon(icon);
          landmarkMarkerRef.current.setTooltipContent(landmark.name);
        } else {
          landmarkMarkerRef.current = L.marker([landmark.lat, landmark.lng], { icon })
            .addTo(map)
            .bindTooltip(landmark.name, {
              permanent: true,
              direction: "top",
              offset: [0, -36],
              className: "wayfarer-map-label",
            });
        }
      } else if (landmarkMarkerRef.current) {
        landmarkMarkerRef.current.remove();
        landmarkMarkerRef.current = null;
      }

      if (current && landmark) {
        map.fitBounds(
          [
            [current.lat, current.lng],
            [landmark.lat, landmark.lng],
          ],
          { paddingTopLeft: [60, 100], paddingBottomRight: [60, bottomRef.current], maxZoom: 16 },
        );
      } else if (current) {
        map.setView([current.lat, current.lng], Math.max(map.getZoom(), 15));
      }
    });

    return () => {
      active = false;
    };
  }, [current, landmark]);

  // Pins for real places nearby. Tapping a pin offers to tell its story.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let active = true;
    void import("leaflet").then((L) => {
      if (!active || !mapRef.current) return;
      placesLayerRef.current?.remove();
      const layer = L.layerGroup();
      for (const place of places) {
        const icon = L.divIcon({
          className: "wayfarer-place-shell",
          html: '<span class="wayfarer-marker-place"></span>',
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker([place.lat, place.lng], { icon });
        const box = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = place.title;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Tell me about this";
        button.style.cssText =
          "display:block;margin-top:8px;padding:6px 12px;border-radius:9999px;background:#f5b43a;color:#0f1424;font-weight:600;border:0;cursor:pointer";
        button.onclick = () => {
          marker.closePopup();
          onPickRef.current?.(place.title);
        };
        box.append(title, button);
        marker.bindPopup(box);
        layer.addLayer(marker);
      }
      layer.addTo(mapRef.current);
      placesLayerRef.current = layer;
    });

    return () => {
      active = false;
    };
  }, [places]);

  useEffect(() => {
    if (!recenterKey) return;
    const map = mapRef.current;
    if (!map || !current) return;
    map.setView([current.lat, current.lng], Math.max(map.getZoom(), 16), { animate: true });
  }, [recenterKey, current]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Current location map" />;
}
