// Round 4A: places as pins on the map, and interests. Run once from the project folder.
// Needs Rounds 1 to 3 to be applied first.
import fs from "node:fs";

const log = (m) => console.log(m);
let problems = 0;

function edit(file, fn) {
  if (!fs.existsSync(file)) { log(`PROBLEM: ${file} not found`); problems++; return; }
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const before = raw.replace(/\r\n/g, "\n");
  const after = fn(before);
  if (after === before) { log(`unchanged ${file}`); return; }
  fs.writeFileSync(file, crlf ? after.replace(/\n/g, "\r\n") : after);
  log(`edited    ${file}`);
}
function swap(text, find, replace, label) {
  if (!text.includes(find)) { log(`PROBLEM: could not find ${label}`); problems++; return text; }
  return text.replace(find, () => replace);
}
function swapAll(text, find, replace, label) {
  if (!text.includes(find)) { log(`PROBLEM: could not find ${label}`); problems++; return text; }
  return text.split(find).join(replace);
}

// ---------- 1. src/lib/landmark.functions.ts ----------
const placesFn = [
'',
'/* ---------- Places for the map pins ---------- */',
'',
'const PlacesInput = z.object({',
'  lat: z.number(),',
'  lng: z.number(),',
'  language: z.enum(["en", "el"]).default("en"),',
'});',
'',
'export type NearbyPlace = { title: string; lat: number; lng: number; distance: number };',
'',
'export const getNearbyPlaces = createServerFn({ method: "POST" })',
'  .inputValidator((input: unknown) => PlacesInput.parse(input))',
'  .handler(async ({ data }): Promise<NearbyPlace[]> => {',
'    const places = await findCandidates(data.lat, data.lng, [], 20, data.language);',
'    return places.map(({ title, lat, lng, distance }) => ({ title, lat, lng, distance }));',
'  });',
'',
].join("\n");

edit("src/lib/landmark.functions.ts", (t) => {
  t = swapAll(t, '  language: z.enum(["en", "el"]).default("en"),\n',
    '  language: z.enum(["en", "el"]).default("en"),\n  interests: z.array(z.string().max(30)).max(8).default([]),\n', "language fields");
  t = swap(t, "  opts: { mode: string; language: string },",
    "  opts: { mode: string; language: string; interests: string[] },", "askForStory options");
  t = swap(t, '      : " Write every text field in English.");',
    [
      '      : " Write every text field in English.") +',
      '    (opts.interests.length > 0',
      '      ? ` The listener is especially interested in: ${opts.interests.join(", ")}. When choosing a place, prefer ones related to these themes and highlight that angle.`',
      '      : "");',
    ].join("\n"), "English instruction");
  return t.replace(/\n*$/, "\n") + placesFn;
});

// ---------- 2. src/components/LandmarkMap.tsx (whole file) ----------
const mapFile = String.raw`import { useEffect, useRef } from "react";
import type { LayerGroup, Map as LeafletMap, Marker } from "leaflet";

type Point = { lat: number; lng: number };

type Props = {
  current: Point | null;
  landmark: (Point & { name: string }) | null;
  recenterKey?: number;
  places?: (Point & { title: string })[];
  onPick?: (title: string) => void;
};

export function LandmarkMap({ current, landmark, recenterKey = 0, places = [], onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const currentMarkerRef = useRef<Marker | null>(null);
  const landmarkMarkerRef = useRef<Marker | null>(null);
  const placesLayerRef = useRef<LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

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
          { paddingTopLeft: [60, 100], paddingBottomRight: [60, 330], maxZoom: 16 },
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
`;
fs.writeFileSync("src/components/LandmarkMap.tsx", mapFile);
log("written   src/components/LandmarkMap.tsx");

// ---------- 3. src/styles.css ----------
edit("src/styles.css", (t) => {
  if (t.includes(".wayfarer-marker-place")) return t;
  return t.replace(/\n*$/, "\n") + [
    "",
    "/* Pins for nearby places */",
    ".wayfarer-place-shell {",
    "  display: grid;",
    "  place-items: center;",
    "  background: transparent;",
    "  border: 0;",
    "}",
    ".wayfarer-marker-place {",
    "  display: block;",
    "  width: 16px;",
    "  height: 16px;",
    "  border-radius: 9999px;",
    "  background: #f5b43a;",
    "  border: 2px solid #0f1424;",
    "  box-shadow: 0 0 0 3px rgba(245, 180, 58, 0.45);",
    "}",
    "",
  ].join("\n");
});

// ---------- 4. src/routes/index.tsx ----------
const stateBlock = [
'  useEffect(() => {',
'    if (!prefsLoaded) return;',
'    try {',
'      localStorage.setItem("compass-history", JSON.stringify(history));',
'      localStorage.setItem("compass-mode", mode);',
'      localStorage.setItem("compass-language", language);',
'    } catch {',
'      /* storage unavailable */',
'    }',
'  }, [history, mode, language, prefsLoaded]);',
'  const [interests, setInterests] = useState<string[]>([]);',
'  const [interestsLoaded, setInterestsLoaded] = useState(false);',
'  const interestsRef = useRef<string[]>([]);',
'  useEffect(() => {',
'    interestsRef.current = interests;',
'  }, [interests]);',
'  useEffect(() => {',
'    try {',
'      const saved = localStorage.getItem("compass-interests");',
'      if (saved) {',
'        const list = JSON.parse(saved) as unknown;',
'        if (Array.isArray(list)) {',
'          setInterests(list.filter((item): item is string => typeof item === "string").slice(0, 8));',
'        }',
'      }',
'    } catch {',
'      /* storage unavailable */',
'    }',
'    setInterestsLoaded(true);',
'  }, []);',
'  useEffect(() => {',
'    if (!interestsLoaded) return;',
'    try {',
'      localStorage.setItem("compass-interests", JSON.stringify(interests));',
'    } catch {',
'      /* storage unavailable */',
'    }',
'  }, [interests, interestsLoaded]);',
'  // Real places around you, shown as pins on the map.',
'  const [places, setPlaces] = useState<NearbyPlace[]>([]);',
'  const placesPointRef = useRef<[number, number] | null>(null);',
'  const placesLanguageRef = useRef("");',
'  useEffect(() => {',
'    if (!coords || !prefsLoaded) return;',
'    const last = placesPointRef.current;',
'    if (last && placesLanguageRef.current === language && distance(last, coords) < 400) return;',
'    placesPointRef.current = coords;',
'    placesLanguageRef.current = language;',
'    fetchPlaces({ data: { lat: coords[0], lng: coords[1], language } })',
'      .then(setPlaces)',
'      .catch(() => undefined);',
'  }, [coords, language, prefsLoaded, fetchPlaces]);',
].join("\n");

const interestsUi = [
'              <div className="space-y-2">',
'                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Interests</p>',
'                <p className="text-xs text-muted-foreground">Pick what you enjoy. Leave empty for everything.</p>',
'                <div className="flex flex-wrap gap-2">',
'                  {["History", "Architecture", "Nature", "Myths and legends", "Art and culture", "Religion"].map((topic) => {',
'                    const active = interests.includes(topic);',
'                    return (',
'                      <button',
'                        key={topic}',
'                        onClick={() =>',
'                          setInterests((prev) => (active ? prev.filter((item) => item !== topic) : [...prev, topic]))',
'                        }',
'                        className={`rounded-full border px-3 py-1.5 text-sm ${',
'                          active ? "border-primary bg-primary text-primary-foreground" : "border-border"',
'                        }`}',
'                      >',
'                        {topic}',
'                      </button>',
'                    );',
'                  })}',
'                </div>',
'              </div>',
'',
].join("\n");

const voiceAnchor = '              <div className="space-y-2">\n                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Voice</p>';

edit("src/routes/index.tsx", (t) => {
  t = swap(t, 'import { describeNearby, getNearbyStory, type LandmarkStory } from "@/lib/landmark.functions";',
    'import {\n  describeNearby,\n  getNearbyPlaces,\n  getNearbyStory,\n  type LandmarkStory,\n  type NearbyPlace,\n} from "@/lib/landmark.functions";', "landmark import");
  t = swap(t, "  const fetchDescribed = useServerFn(describeNearby);",
    "  const fetchDescribed = useServerFn(describeNearby);\n  const fetchPlaces = useServerFn(getNearbyPlaces);", "server function setup");
  t = swap(t,
    "  useEffect(() => {\n    if (!prefsLoaded) return;\n    try {\n      localStorage.setItem(\"compass-history\", JSON.stringify(history));\n      localStorage.setItem(\"compass-mode\", mode);\n      localStorage.setItem(\"compass-language\", language);\n    } catch {\n      /* storage unavailable */\n    }\n  }, [history, mode, language, prefsLoaded]);",
    stateBlock, "Round 3 settings block (Round 3 must be applied first)");
  t = swapAll(t, "language: languageRef.current,\n", "language: languageRef.current,\n            interests: interestsRef.current,\n", "requests");
  t = swap(t, voiceAnchor, interestsUi + voiceAnchor, "Voice section of the menu");
  t = swap(t, "          recenterKey={recenterKey}\n        />",
    "          recenterKey={recenterKey}\n          places={places}\n          onPick={(title) => {\n            unlockAudio();\n            void runDescribed(`Tell me about ${title}`);\n          }}\n        />", "map component");
  return t;
});

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");