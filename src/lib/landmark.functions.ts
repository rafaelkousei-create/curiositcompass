import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateStructuredText } from "./ai-gateway.server";

const Input = z.object({
  lat: z.number(),
  lng: z.number(),
  heard: z.array(z.string()).max(40).default([]),
  mode: z.enum(["driving", "walking"]).default("driving"),
  language: z.enum(["en", "el"]).default("en"),
  interests: z.array(z.string().max(30)).max(8).default([]),
});

const StorySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "found",
    "name",
    "area",
    "category",
    "headline",
    "story",
    "distanceHint",
    "lat",
    "lng",
  ],
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    area: { type: "string" },
    category: { type: "string" },
    headline: { type: "string" },
    story: { type: "string" },
    distanceHint: { type: "string" },
    lat: { type: "number" },
    lng: { type: "number" },
  },
} as const;

export type LandmarkStory = {
  found: boolean;
  name: string;
  area: string;
  category: string;
  headline: string;
  story: string;
  distanceHint: string;
  lat: number;
  lng: number;
  image: string;
  url: string;
};

const StoryParser = z.object({
  found: z.boolean(),
  name: z.string(),
  area: z.string(),
  category: z.string(),
  headline: z.string(),
  story: z.string(),
  distanceHint: z.string(),
  lat: z.number().default(0),
  lng: z.number().default(0),
  image: z.string().default(""),
  url: z.string().default(""),
});

const EMPTY_STORY: LandmarkStory = {
  found: false,
  name: "",
  area: "",
  category: "",
  headline: "",
  story: "",
  distanceHint: "",
  lat: 0,
  lng: 0,
  image: "",
  url: "",
};

async function askForStory(
  instructions: string,
  input: string,
  opts: { mode: string; language: string; interests: string[] },
): Promise<LandmarkStory> {
  const tuned =
    instructions.replace("70-130 words", opts.mode === "walking" ? "100-170 words" : "70-130 words") +
    (opts.language === "el"
      ? " Write headline, story, area, category and distanceHint in Greek. When you chose a place from the list, keep name exactly as in the list."
      : " Write every text field in English.") +
    (opts.interests.length > 0
      ? ` The listener is especially interested in: ${opts.interests.join(", ")}. When choosing a place, prefer ones related to these themes and highlight that angle.`
      : "");
  const text = await generateStructuredText({
    instructions: tuned,
    input,
    schema: StorySchema as unknown as Record<string, unknown>,
    schemaName: "landmark_story",
  });
  try {
    return StoryParser.parse(JSON.parse(text));
  } catch {
    return EMPTY_STORY;
  }
}

/* ---------- Real nearby places from Wikipedia ---------- */

type Place = {
  title: string;
  lat: number;
  lng: number;
  distance: number; // metres
  notes: string;
  image: string;
  url: string;
};

type WikiPage = {
  title: string;
  extract?: string;
  coordinates?: { lat: number; lon: number }[];
  thumbnail?: { source: string };
  fullurl?: string;
};

function metresBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

async function wikipediaNearby(
  lat: number,
  lng: number,
  radius: number,
  lang: string,
): Promise<Place[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(radius),
    ggslimit: "20",
    prop: "extracts|coordinates|pageimages|info",
    piprop: "thumbnail",
    pithumbsize: "640",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exlimit: "max",
    exchars: "700",
  });
  try {
    const response = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params.toString()}`, {
      headers: { "User-Agent": "CuriosityCompass/1.0 (personal landmark guide app)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const pages = Object.values(data.query?.pages ?? {});
    const places: Place[] = [];
    for (const page of pages) {
      const point = page.coordinates?.[0];
      if (!point || !page.extract) continue;
      places.push({
        title: page.title,
        lat: point.lat,
        lng: point.lon,
        distance: Math.round(metresBetween(lat, lng, point.lat, point.lon)),
        notes: page.extract.replace(/\s+/g, " ").trim(),
        image: page.thumbnail?.source ?? "",
        url: page.fullurl ?? "",
      });
    }
    return places.sort((a, b) => a.distance - b.distance);
  } catch (error) {
    console.error("Wikipedia lookup failed:", error);
    return [];
  }
}

/** Nearby places that have not been told yet; widens the search if the first is empty. */
async function findCandidates(
  lat: number,
  lng: number,
  heard: string[],
  limit = 8,
  lang = "en",
): Promise<Place[]> {
  const told = heard.map((h) => h.toLowerCase());
  const fresh = (places: Place[]) =>
    places.filter((p) => !told.some((h) => h.includes(p.title.toLowerCase())));

  // Search in the chosen language first, then in English.
  const nearby = async (radius: number) => {
    let found = fresh(await wikipediaNearby(lat, lng, radius, lang));
    if (found.length === 0 && lang !== "en") found = fresh(await wikipediaNearby(lat, lng, radius, "en"));
    return found;
  };
  let places = await nearby(1000);
  if (places.length === 0) places = await nearby(5000);
  return places.slice(0, limit);
}

/** Adds the photo and Wikipedia link of the place the AI chose, matched by name or position. */
function withMedia(story: LandmarkStory, places: Place[]): LandmarkStory {
  if (!story.found) return story;
  const name = story.name.trim().toLowerCase();
  let match = places.find((p) => p.title.toLowerCase() === name);
  if (!match && name) {
    match = places.find(
      (p) => p.title.toLowerCase().includes(name) || name.includes(p.title.toLowerCase()),
    );
  }
  if (!match && (story.lat !== 0 || story.lng !== 0)) {
    match = places.find((p) => metresBetween(story.lat, story.lng, p.lat, p.lng) < 60);
  }
  return match ? { ...story, image: match.image, url: match.url } : story;
}

/** Everything on the map nearby (airfields, viewpoints, ruins, lakes, factories...) from OpenStreetMap. */
async function osmNearby(lat: number, lng: number): Promise<Place[]> {
  const query = `[out:json][timeout:8];(
    nwr(around:3000,${lat},${lng})[aeroway~"^(aerodrome|heliport|airstrip)$"];
    nwr(around:1500,${lat},${lng})[name][~"^(tourism|historic|aeroway|natural|man_made|leisure|waterway|military|power|railway|bridge)$"~"."];
  );out center 80;`;
  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "CuriosityCompass/1.0 (personal landmark guide app)",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      elements?: {
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }[];
    };
    const kinds = ["aeroway", "tourism", "historic", "natural", "man_made", "leisure", "waterway", "military", "power", "railway", "bridge"];
    const places: Place[] = [];
    for (const element of data.elements ?? []) {
      const tags = element.tags ?? {};
      const pLat = element.lat ?? element.center?.lat;
      const pLng = element.lon ?? element.center?.lon;
      if (pLat === undefined || pLng === undefined) continue;
      const kind = kinds.find((k) => tags[k]);
      if (!kind) continue;
      const title = tags.name || tags["name:en"] || `Unnamed ${tags[kind].replace(/_/g, " ")}`;
      places.push({
        title,
        lat: pLat,
        lng: pLng,
        distance: Math.round(metresBetween(lat, lng, pLat, pLng)),
        notes: `Map data: ${kind} = ${tags[kind]}${tags.operator ? `, operator ${tags.operator}` : ""}${tags.description ? `, ${tags.description}` : ""}`,
        image: "",
        url: "",
      });
    }
    return places.sort((a, b) => a.distance - b.distance).slice(0, 30);
  } catch (error) {
    console.error("Map lookup failed:", error);
    return [];
  }
}

/* ---------- Server functions ---------- */

export const getNearbyStory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const listener =
      data.mode === "driving"
        ? "who is driving a car and cannot look at a screen."
        : "who is walking around on foot.";

    const candidates = await findCandidates(data.lat, data.lng, data.heard, 8, data.language);

    if (candidates.length > 0) {
      // Grounded mode: the AI only tells the story of a real, nearby place.
      const instructions = [
        "You are a warm, knowledgeable local guide narrating points of interest to someone",
        listener,
        "You are given a list of REAL places near the listener, each with notes from Wikipedia",
        "and its distance in metres. Choose the ONE most interesting place for a curious visitor",
        "(prefer history, culture, architecture, nature and striking facts; avoid ordinary shops,",
        "schools or streets unless they are genuinely notable). If none is remarkable, still choose",
        "the best one available, and set found to true.",
        "story: 70-130 words of spoken narration - vivid and factual, based on the notes. You may add",
        "well-established facts you are sure of, but never invent dates, names or numbers.",
        "No greetings, no 'welcome to', no mention of coordinates or GPS, ready to be read aloud.",
        "name: the place's name. headline: max 8 words. area: the neighbourhood, town or city.",
        "category: e.g. 'Historic church'.",
        "distanceHint: a short spoken cue based on the given distance, like 'about 300 metres from you'.",
        "lat/lng: copy the coordinates given for the chosen place.",
      ].join(" ");

      const input = [
        `Listener position: ${data.lat}, ${data.lng}`,
        "Nearby places:",
        ...candidates.map(
          (p, i) =>
            `${i + 1}. ${p.title} | ${p.distance} metres away | lat ${p.lat}, lng ${p.lng} | notes: ${p.notes}`,
        ),
      ].join("\n");

      const story = await askForStory(instructions, input, data);
      if (story.found && story.story) return withMedia(story, candidates);
    }

    // Fallback: no Wikipedia places found, so rely on the AI's own knowledge, with a wider reach.
    const instructions = [
      "You are a warm, knowledgeable local guide narrating points of interest to someone",
      listener,
      "Given GPS coordinates (which may be a few hundred metres inaccurate), identify ONE genuinely",
      "interesting real landmark, building, monument, neighbourhood, bridge, ruin, church, square,",
      "street, park or historic site within about one kilometre of those coordinates.",
      "If nothing specific is close, you may tell the story of the neighbourhood, district or town",
      "itself: its history, character and how it developed. Only pick things you actually know exist.",
      "Set found to false only if you know nothing at all about this area; then leave the other",
      "text fields as empty strings.",
      "story: 70-130 words of spoken narration - vivid, factual, specific dates and names, no",
      "greetings, no 'welcome to', no mention of coordinates or GPS, ready to be read aloud.",
      "headline: max 8 words. area: the neighbourhood, town or city. category: e.g. 'Historic church'.",
      "distanceHint: a short spoken cue like 'just on your right', 'in this area' or 'about 400 metres ahead'.",
      "lat/lng: the real decimal coordinates of the place itself, as precise as you know them",
      "(use 0 and 0 only when found is false).",
      "Never repeat a landmark that appears in the already-told list.",
    ].join(" ");

    const input = [
      `Latitude: ${data.lat}`,
      `Longitude: ${data.lng}`,
      `Already told: ${data.heard.length ? data.heard.join("; ") : "(nothing yet)"}`,
    ].join("\n");

    return askForStory(instructions, input, data);
  });

const DescribeInput = z.object({
  lat: z.number(),
  lng: z.number(),
  description: z.string().min(2).max(400),
  mode: z.enum(["driving", "walking"]).default("driving"),
  language: z.enum(["en", "el"]).default("en"),
  interests: z.array(z.string().max(30)).max(8).default([]),
});

export const describeNearby = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DescribeInput.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    // Everything around the person: Wikipedia articles plus anything on the map.
    const [wiki, wikiEn, osm] = await Promise.all([
      wikipediaNearby(data.lat, data.lng, 3000, data.language),
      data.language !== "en" ? wikipediaNearby(data.lat, data.lng, 3000, "en") : Promise.resolve([]),
      osmNearby(data.lat, data.lng),
    ]);
    const seen = new Set<string>();
    const candidates: Place[] = [];
    for (const place of [...wiki, ...wikiEn, ...osm].sort((a, b) => a.distance - b.distance)) {
      const key = place.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(place);
    }
    const list = candidates.slice(0, 40);

    const instructions = [
      "You are a warm, knowledgeable local guide who can talk about ANYTHING near the listener,",
      "not only famous landmarks: a small airfield, a bridge, a factory, a farm, a lake, a statue,",
      "an odd building, a view, a type of tree or rock - whatever they ask about.",
      data.mode === "driving" ? "The person is in a car and cannot look at a screen." : "The person is on foot.",
      "They describe something they see or ask a question. You are given places near them (Wikipedia",
      "articles and map data) with distances in metres. Their words may include directions like",
      "left or right; you do not know which way they face, so ignore directions.",
      "1) If one of the listed places fits what they said, choose it and tell its story using the notes.",
      "2) If nothing listed fits, answer from your own reliable knowledge about that kind of thing",
      "(for example what a small airfield or a wind farm is, how it works, why it is there, what is",
      "interesting about it). Say honestly that you cannot be sure which exact one it is, for example:",
      "It is probably a small airfield, and places like this usually...",
      "3) If they ask a question, answer it directly first.",
      "Always give a helpful, interesting answer. Set found to false ONLY if the request is",
      "meaningless or you truly cannot say anything useful; then leave the other text fields empty.",
      "story: 70-140 words of spoken narration, vivid and factual, never invent dates, names or",
      "numbers, no greetings, no mention of coordinates or GPS, ready to be read aloud.",
      "name: the place or topic name (a short title is fine). headline: max 8 words.",
      "area: the neighbourhood, town or city. category: e.g. Small airfield.",
      "distanceHint: a short spoken cue like about 300 metres from you, or nearby.",
      "lat/lng: the coordinates of the place (copy them from the list when you chose from it;",
      "otherwise use 0 and 0).",
    ].join(" ");

    const input = [
      `Listener position: ${data.lat}, ${data.lng}`,
      `They said: ${data.description}`,
      list.length > 0 ? "Places nearby:" : "No nearby places were found in the databases.",
      ...list.map(
        (p, i) =>
          `${i + 1}. ${p.title} | ${p.distance} metres away | lat ${p.lat}, lng ${p.lng} | notes: ${p.notes}`,
      ),
    ].join("\n");

    return withMedia(await askForStory(instructions, input, { ...data, interests: [] }), list);
  });

/* ---------- Places for the map pins ---------- */

const PlacesInput = z.object({
  lat: z.number(),
  lng: z.number(),
  language: z.enum(["en", "el"]).default("en"),
});

export type NearbyPlace = { title: string; lat: number; lng: number; distance: number };

export const getNearbyPlaces = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PlacesInput.parse(input))
  .handler(async ({ data }): Promise<NearbyPlace[]> => {
    const places = await findCandidates(data.lat, data.lng, [], 20, data.language);
    return places.map(({ title, lat, lng, distance }) => ({ title, lat, lng, distance }));
  });
