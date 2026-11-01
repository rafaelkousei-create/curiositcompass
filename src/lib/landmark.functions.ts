import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { generateStructuredText } from "./ai-gateway.server";

const Input = z.object({
  lat: z.number(),
  lng: z.number(),
  heard: z.array(z.string()).max(100).default([]),
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
    "covered",
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
    covered: { type: "array", items: { type: "string" } },
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
  covered: string[];
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
  covered: z.array(z.string()).default([]),
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
  covered: [],
  image: "",
  url: "",
};

/** Style rules added to every story: facts, not promotion. */
const STYLE_RULES =
  " STYLE: tell facts, never promote. Every sentence must carry concrete information: who built or founded it," +
  " when, how big it is, what it was used for, what happened there, how it works, why it has its name, or a" +
  " surprising detail. Never use brochure language such as charming, picturesque, beautiful, stunning," +
  " breathtaking, idyllic, quaint, vibrant, must-see, hidden gem, rich history, nestled, boasts, worth a visit," +
  " perfect for, and never invite the listener to visit or explore. Do not praise the place or tell the listener" +
  " how to feel. Do not describe architecture or atmosphere in general terms; name specific, verifiable features" +
  " only. If the notes hold few facts, write a shorter story instead of padding it. Start with the most" +
  " interesting fact, not with a greeting, and vary how stories begin. Never retell anything already told.";

async function askForStory(
  instructions: string,
  input: string,
  opts: { mode: string; language: string; interests: string[]; model?: string },
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
    instructions: tuned + STYLE_RULES,
    model: opts.model,
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
  qid?: string;
};

type WikiPage = {
  title: string;
  extract?: string;
  coordinates?: { lat: number; lon: number }[];
  thumbnail?: { source: string };
  fullurl?: string;
  pageprops?: { wikibase_item?: string };
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
    prop: "extracts|coordinates|pageimages|info|pageprops",
    ppprop: "wikibase_item",
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
        qid: page.pageprops?.wikibase_item ?? "",
      });
    }
    return places.sort((a, b) => a.distance - b.distance);
  } catch (error) {
    console.error("Wikipedia lookup failed:", error);
    return [];
  }
}

/** Lower case, no accents, only letters and digits, so names can be compared reliably. */
function norm(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Nearby places that have not been told yet; widens the search until something new is found. */
async function findCandidates(
  lat: number,
  lng: number,
  heard: string[],
  limit = 8,
  lang = "en",
): Promise<Place[]> {
  const told = heard.map(norm).filter((h) => h.length > 2);
  const isTold = (title: string) => {
    const n = norm(title);
    if (n.length < 3) return false;
    return told.some((h) => h === n || (n.length >= 5 && h.includes(n)) || (h.length >= 5 && n.includes(h)));
  };
  const fresh = (places: Place[]) => places.filter((p) => !isTold(p.title));

  // Search in the chosen language first, then in English.
  const nearby = async (radius: number) => {
    let found = fresh(await wikipediaNearby(lat, lng, radius, lang));
    if (found.length === 0 && lang !== "en") found = fresh(await wikipediaNearby(lat, lng, radius, "en"));
    return found;
  };
  let places = await nearby(1000);
  if (places.length === 0) places = await nearby(3000);
  if (places.length === 0) places = await nearby(8000);
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

/* ---------- Wikidata: verified facts (dates, sizes, names) ---------- */

const FACT_PROPS: Record<string, string> = {
  P571: "founded or built",
  P1619: "officially opened",
  P576: "ended or demolished",
  P84: "architect",
  P149: "architectural style",
  P138: "named after",
  P112: "founded by",
  P170: "creator",
  P2048: "height",
  P2044: "elevation above sea level",
  P1082: "population",
  P2046: "area",
  P1435: "heritage status",
};

type WdClaim = { mainsnak?: { snaktype?: string; datavalue?: { value?: unknown } }; rank?: string };
type WdEntity = { claims?: Record<string, WdClaim[]>; labels?: Record<string, { value?: string }> };

function bestClaims(claims: WdClaim[] | undefined) {
  const good = (claims ?? []).filter((c) => c.mainsnak?.snaktype === "value" && c.rank !== "deprecated");
  const preferred = good.filter((c) => c.rank === "preferred");
  return (preferred.length > 0 ? preferred : good).slice(0, 2);
}

function wikidataYear(value: unknown) {
  const time = (value as { time?: string } | null)?.time;
  const match = time ? /^([+-])(\d+)-/.exec(time) : null;
  if (!match) return "";
  const year = Number(match[2]);
  return match[1] === "-" ? `${year} BC` : String(year);
}

async function wikidataFacts(qids: string[], lang: string): Promise<Record<string, string>> {
  const ids = [...new Set(qids.filter((q) => /^Q\d+$/.test(q)))].slice(0, 40);
  if (ids.length === 0) return {};
  const api = "https://www.wikidata.org/w/api.php";
  const headers = { "User-Agent": "CuriosityCompass/1.0 (personal landmark guide app)" };
  try {
    const first = await fetch(
      `${api}?${new URLSearchParams({ action: "wbgetentities", format: "json", ids: ids.join("|"), props: "claims" })}`,
      { headers, signal: AbortSignal.timeout(6000) },
    );
    if (!first.ok) return {};
    const entities = ((await first.json()) as { entities?: Record<string, WdEntity> }).entities ?? {};

    // Names for the things the facts point to (architects, styles, units...).
    const wanted = new Set<string>();
    for (const entity of Object.values(entities)) {
      for (const prop of Object.keys(FACT_PROPS)) {
        for (const claim of bestClaims(entity.claims?.[prop])) {
          const value = claim.mainsnak?.datavalue?.value as { id?: string; unit?: string } | undefined;
          if (value?.id) wanted.add(value.id);
          const unit = value?.unit ? /Q\d+$/.exec(value.unit) : null;
          if (unit) wanted.add(unit[0]);
        }
      }
    }
    const labels: Record<string, string> = {};
    if (wanted.size > 0) {
      const second = await fetch(
        `${api}?${new URLSearchParams({
          action: "wbgetentities",
          format: "json",
          ids: [...wanted].slice(0, 50).join("|"),
          props: "labels",
          languages: [...new Set([lang, "en"])].join("|"),
        })}`,
        { headers, signal: AbortSignal.timeout(6000) },
      );
      if (second.ok) {
        const named = ((await second.json()) as { entities?: Record<string, WdEntity> }).entities ?? {};
        for (const [id, entity] of Object.entries(named)) {
          const label = entity.labels?.[lang]?.value ?? entity.labels?.en?.value;
          if (label) labels[id] = label;
        }
      }
    }

    const result: Record<string, string> = {};
    for (const [qid, entity] of Object.entries(entities)) {
      const parts: string[] = [];
      for (const [prop, name] of Object.entries(FACT_PROPS)) {
        const values = bestClaims(entity.claims?.[prop])
          .map((claim) => {
            const value = claim.mainsnak?.datavalue?.value as
              | { id?: string; time?: string; amount?: string; unit?: string }
              | string
              | undefined;
            if (!value || typeof value === "string") return "";
            if (value.time) return wikidataYear(value);
            if (value.id) return labels[value.id] ?? "";
            if (value.amount) {
              const amount = Number(value.amount);
              if (!Number.isFinite(amount)) return "";
              const unit = value.unit ? /Q\d+$/.exec(value.unit) : null;
              return `${amount} ${unit ? (labels[unit[0]] ?? "") : ""}`.trim();
            }
            return "";
          })
          .filter(Boolean);
        if (values.length > 0) parts.push(`${name}: ${[...new Set(values)].join(", ")}`);
      }
      if (parts.length > 0) result[qid] = parts.join("; ");
    }
    return result;
  } catch (error) {
    console.error("Wikidata lookup failed:", error);
    return {};
  }
}

/** Adds the verified Wikidata facts to the notes of each place. */
async function withFacts(places: Place[], lang: string): Promise<Place[]> {
  const facts = await wikidataFacts(places.map((p) => p.qid ?? ""), lang);
  return places.map((p) =>
    p.qid && facts[p.qid] ? { ...p, notes: `${p.notes} | Verified facts (Wikidata): ${facts[p.qid]}` } : p,
  );
}

/** The full text of a Wikipedia article (first part), for long stories. */
async function wikipediaLong(title: string, lang: string): Promise<string> {
  for (const wiki of lang === "en" ? ["en"] : [lang, "en"]) {
    try {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        prop: "extracts",
        explaintext: "1",
        redirects: "1",
        titles: title,
      });
      const response = await fetch(`https://${wiki}.wikipedia.org/w/api.php?${params.toString()}`, {
        headers: { "User-Agent": "CuriosityCompass/1.0 (personal landmark guide app)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { query?: { pages?: Record<string, { extract?: string }> } };
      const text = Object.values(data.query?.pages ?? {})[0]?.extract?.replace(/\n{2,}/g, "\n").trim();
      if (text && text.length > 200) return text.slice(0, 7000);
    } catch (error) {
      console.error("Wikipedia article lookup failed:", error);
    }
  }
  return "";
}

/* ---------- Server functions ---------- */

export const getNearbyStory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const listener =
      data.mode === "driving"
        ? "who is driving a car and cannot look at a screen."
        : "who is walking around on foot.";

    let candidates = await withFacts(
      await findCandidates(data.lat, data.lng, data.heard, 12, data.language),
      data.language,
    );
    if (candidates.length === 0) {
      const toldNames = data.heard.map(norm).filter((h) => h.length > 2);
      const isToldTitle = (title: string) => {
        const n = norm(title);
        return toldNames.some((h) => h === n || (n.length >= 5 && h.includes(n)) || (h.length >= 5 && n.includes(h)));
      };
      candidates = (await osmNearby(data.lat, data.lng))
        .filter((p) => !p.title.startsWith("Unnamed") && !isToldTitle(p.title))
        .slice(0, 12);
    }

    if (candidates.length > 0) {
      // Grounded mode: the AI only tells the story of a real, nearby place.
      const instructions = [
        "You are a warm, knowledgeable local guide narrating points of interest to someone",
        listener,
        "You are given REAL places near the listener, each with notes from Wikipedia and its distance in",
        "metres, and a list of topics that were ALREADY told.",
        "Pick the ONE most interesting topic for a curious person (history, culture, engineering, nature,",
        "striking facts; skip ordinary shops, schools, streets and purely administrative areas unless notable).",
        "Never retell anything from the already-told list, not even another side of the same village or site.",
        "If several listed places belong to the same village, town or site (the village itself, its church,",
        "its square, its municipal unit and so on), COMBINE them into ONE story with the best distinct facts",
        "and put the titles of every place you used or merged into covered, so they are not told again.",
        "Set found to true whenever a listed place is not already told. Set found to false only if every",
        "listed place is already covered by the told list.",
        "Notes may include a Verified facts (Wikidata) section with dates, sizes and names: use those numbers, they are the most reliable.",
        "story: 70-130 words of spoken narration based on the notes. You may add well-established facts you",
        "are sure of, but never invent dates, names or numbers. No greetings, no 'welcome to', no mention of",
        "coordinates or GPS, ready to be read aloud.",
        "name: the main place's title exactly as in the list. headline: max 8 words. area: the town or city.",
        "category: e.g. 'Historic church'.",
        "distanceHint: a short spoken cue based on the given distance, like 'about 300 metres from you'.",
        "covered: the titles, exactly as in the list, of every place the story used or merged (at least the main one).",
        "lat/lng: copy the coordinates given for the main place.",
      ].join(" ");

      const input = [
        `Listener position: ${data.lat}, ${data.lng}`,
        `Already told (do not repeat): ${data.heard.length ? data.heard.join("; ") : "(nothing yet)"}`,
        "Nearby places:",
        ...candidates.map(
          (p, i) =>
            `${i + 1}. ${p.title} | ${p.distance} metres away | lat ${p.lat}, lng ${p.lng} | notes: ${p.notes}`,
        ),
      ].join("\n");

      const story = await askForStory(instructions, input, data);
      if (story.found && story.story) return withMedia(story, candidates);
      // Everything nearby is already covered: say nothing rather than repeat.
      return EMPTY_STORY;
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
      "Never repeat a landmark that appears in the already-told list. If the village or area itself was",
      "already told, set found to false instead of retelling it.",
      "covered: an empty list.",
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
    const list = await withFacts(candidates.slice(0, 40), data.language);

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
      "otherwise use 0 and 0). covered: an empty list.",
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

/* ---------- "I am curious": a 3 minute story ---------- */

const GENERAL_TOPICS = [
  "an unusual fact about the sea, ships or navigation",
  "how an everyday object was invented",
  "a surprising event in ancient history",
  "the science of weather, the sky or the seasons",
  "an animal with a remarkable ability",
  "a famous journey or expedition",
  "how a famous bridge, tunnel, canal or road was built",
  "a strange law, custom or tradition somewhere in the world",
  "a scientist or inventor and what they got right or wrong",
  "how a language, alphabet or number system developed",
  "a remarkable natural phenomenon",
  "the history of a food or a drink",
  "an engineering failure and what was learned from it",
  "one space mission and what it found out",
  "one surprising way the human body works",
];

const PickSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "general"],
  properties: { title: { type: "string" }, general: { type: "boolean" } },
} as const;

const LONG_RULES = [
  "story: 420-480 words (about three minutes when read aloud; never fewer than 350).",
  "One coherent spoken story: open with the most striking fact, develop it in a logical order",
  "(chronological or cause and effect), connect the details, and close with a fitting last fact.",
  "Plain spoken sentences; no lists, no headings, no emoji, no greetings, no mention of coordinates or GPS.",
  "Use ONLY facts found in the provided material or facts you are completely certain of.",
  "Never invent or guess dates, names, numbers or quotes. If you lack enough facts, tell fewer things",
  "in more depth instead of filling space.",
  "headline: max 8 words. category: e.g. 'Village history' or 'Science story'.",
].join(" ");

export const getCuriousStory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const model = process.env["OPENAI_STORY_MODEL"] || "gpt-4.1";
    const told = data.heard.length ? data.heard.join("; ") : "(nothing yet)";
    const listener =
      data.mode === "driving"
        ? "The listener is driving and cannot look at a screen."
        : "The listener is walking.";

    const candidates = await withFacts(
      await findCandidates(data.lat, data.lng, data.heard, 12, data.language),
      data.language,
    );

    // Step 1: choose a topic from the area, if there is anything with enough substance.
    let chosen: Place | null = null;
    if (candidates.length > 0) {
      try {
        const text = await generateStructuredText({
          instructions: [
            "From the list, choose the topic with the richest, most interesting story that could fill three",
            "minutes: a village, town, region, site, event or person connected to the place. Prefer the broader",
            "subject (the village or area itself, or a notable site) over small details. Never choose a topic from",
            "the already-told list. If nothing has enough substance, set general to true and title to an empty string.",
            "Otherwise copy the title exactly as in the list.",
          ].join(" "),
          input: [
            `Already told: ${told}`,
            "Places:",
            ...candidates.map((p, i) => `${i + 1}. ${p.title} | ${p.distance} metres away | ${p.notes.slice(0, 350)}`),
          ].join("\n"),
          schema: PickSchema as unknown as Record<string, unknown>,
          schemaName: "topic_pick",
        });
        const pick = JSON.parse(text) as { title?: string; general?: boolean };
        if (!pick.general && pick.title) {
          const wanted = pick.title.trim().toLowerCase();
          chosen = candidates.find((p) => p.title.toLowerCase() === wanted) ?? null;
        }
      } catch (error) {
        console.error("Topic choice failed:", error);
      }
    }

    // Step 2a: a long story about the area.
    if (chosen) {
      const article = await wikipediaLong(chosen.title, data.language);
      const related = candidates.filter((p) => p !== chosen).slice(0, 5);
      const instructions = [
        "You are a knowledgeable narrator who tells one factual story about a place near the listener.",
        listener,
        "You are given the main topic with an article text and verified facts, plus a few related places nearby.",
        "Tell the story of the MAIN topic. Mention a related place briefly only if it is truly connected.",
        "Never retell anything from the already-told list.",
        "name: the main topic's title exactly as in the material. area: the town or region.",
        "distanceHint: a short spoken cue like 'about 300 metres from you' or 'in this area'.",
        "covered: the titles (exactly as given) of every place the story used, the main one first.",
        "lat/lng: copy the coordinates given for the main topic.",
        LONG_RULES,
      ].join(" ");
      const input = [
        `Listener position: ${data.lat}, ${data.lng}`,
        `Already told (never repeat): ${told}`,
        `MAIN TOPIC: ${chosen.title} | ${chosen.distance} metres away | lat ${chosen.lat}, lng ${chosen.lng}`,
        `Notes and verified facts: ${chosen.notes}`,
        "Article text:",
        article || "(no longer article available)",
        "Related places nearby:",
        ...related.map((p) => `- ${p.title}: ${p.notes.slice(0, 250)}`),
      ].join("\n");
      const story = await askForStory(instructions, input, { ...data, model });
      if (story.found && story.story) return withMedia(story, [chosen, ...candidates]);
    }

    // Step 2b: a general story or fact.
    const seed = GENERAL_TOPICS[Math.floor(Math.random() * GENERAL_TOPICS.length)];
    const instructions = [
      "You are a knowledgeable narrator who tells one factual story on any subject.",
      listener,
      `Choose one specific, well-documented subject within this theme: ${seed}.`,
      "If there is a natural link to the country or region of the listener, use it; never force one.",
      "Never choose a subject from the already-told list.",
      "name: the subject as a short title. area: an empty string or the region it relates to.",
      "distanceHint: 'a story for the road'.",
      "covered: an empty list. lat/lng: 0 and 0.",
      "Set found to true.",
      LONG_RULES,
    ].join(" ");
    const input = [
      `Listener position (for context only): ${data.lat}, ${data.lng}`,
      `Already told (never repeat): ${told}`,
    ].join("\n");
    const story = await askForStory(instructions, input, { ...data, model });
    return story.found && story.story ? story : EMPTY_STORY;
  });
