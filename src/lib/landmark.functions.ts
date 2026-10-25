import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateStructuredText } from "./ai-gateway.server";

const Input = z.object({
  lat: z.number(),
  lng: z.number(),
  heard: z.array(z.string()).max(40).default([]),
  mode: z.enum(["driving", "walking"]).default("driving"),
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
};

async function askForStory(instructions: string, input: string): Promise<LandmarkStory> {
  const text = await generateStructuredText({
    instructions,
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
};

type WikiPage = {
  title: string;
  extract?: string;
  coordinates?: { lat: number; lon: number }[];
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

async function wikipediaNearby(lat: number, lng: number, radius: number): Promise<Place[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "geosearch",
    ggscoord: `${lat}|${lng}`,
    ggsradius: String(radius),
    ggslimit: "20",
    prop: "extracts|coordinates",
    exintro: "1",
    explaintext: "1",
    exlimit: "max",
    exchars: "700",
  });
  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
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
      });
    }
    return places.sort((a, b) => a.distance - b.distance);
  } catch (error) {
    console.error("Wikipedia lookup failed:", error);
    return [];
  }
}

/** Nearby places that have not been told yet; widens the search if the first is empty. */
async function findCandidates(lat: number, lng: number, heard: string[]): Promise<Place[]> {
  const told = heard.map((h) => h.toLowerCase());
  const fresh = (places: Place[]) =>
    places.filter((p) => !told.some((h) => h.includes(p.title.toLowerCase())));

  let places = fresh(await wikipediaNearby(lat, lng, 1000));
  if (places.length === 0) places = fresh(await wikipediaNearby(lat, lng, 5000));
  return places.slice(0, 8);
}

/* ---------- Server functions ---------- */

export const getNearbyStory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const listener =
      data.mode === "driving"
        ? "who is driving a car and cannot look at a screen."
        : "who is walking around on foot.";

    const candidates = await findCandidates(data.lat, data.lng, data.heard);

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

      const story = await askForStory(instructions, input);
      if (story.found && story.story) return story;
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

    return askForStory(instructions, input);
  });

const DescribeInput = z.object({
  lat: z.number(),
  lng: z.number(),
  description: z.string().min(2).max(400),
  mode: z.enum(["driving", "walking"]).default("driving"),
});

export const describeNearby = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DescribeInput.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const instructions = [
      "You are a warm, knowledgeable local guide.",
      data.mode === "driving"
        ? "The person is in a car and cannot look at a screen."
        : "The person is on foot.",
      "They describe something they can see near their GPS position. Work out which REAL place they",
      "most likely mean - prefer visible landmarks, buildings, monuments, bridges, churches, squares,",
      "statues, hills or streets close to those coordinates. Only name something you actually know",
      "exists there. If you cannot confidently match their description, set found to false and leave",
      "the other text fields as empty strings.",
      "story: 70-130 words of spoken narration - vivid, factual, specific dates and names, no",
      "greetings, no mention of coordinates or GPS, ready to be read aloud.",
      "headline: max 8 words. area: the neighbourhood, town or city. category: e.g. 'Historic church'.",
      "distanceHint: a short spoken cue like 'just on your right' or 'about 200 metres ahead'.",
      "lat/lng: the real decimal coordinates of the place itself (use 0 and 0 only when found is false).",
    ].join(" ");

    const input = [
      `Latitude: ${data.lat}`,
      `Longitude: ${data.lng}`,
      `They said: ${data.description}`,
    ].join("\n");

    return askForStory(instructions, input);
  });