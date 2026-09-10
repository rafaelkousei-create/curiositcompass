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

export const getNearbyStory = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<LandmarkStory> => {
    const instructions = [
      "You are a warm, knowledgeable local guide narrating points of interest to someone",
      data.mode === "driving"
        ? "who is driving a car and cannot look at a screen."
        : "who is walking around on foot.",
      "Given GPS coordinates, identify ONE genuinely interesting real landmark, building, monument,",
      "neighbourhood, bridge, ruin, church, square or historic site very close to those coordinates.",
      "Only pick something you actually know exists there. If you are not confident anything notable",
      "is nearby, set found to false and leave the other text fields as empty strings.",
      "story: 70-130 words of spoken narration - vivid, factual, specific dates and names, no",
      "greetings, no 'welcome to', no mention of coordinates or GPS, ready to be read aloud.",
      "headline: max 8 words. area: the neighbourhood, town or city. category: e.g. 'Historic church'.",
      "distanceHint: a short spoken cue like 'just on your right' or 'about 200 metres ahead'.",
      "Never repeat a landmark that appears in the already-told list.",
    ].join(" ");

    const input = [
      `Latitude: ${data.lat}`,
      `Longitude: ${data.lng}`,
      `Already told: ${data.heard.length ? data.heard.join("; ") : "(nothing yet)"}`,
    ].join("\n");

    const text = await generateStructuredText({
      instructions,
      input,
      schema: StorySchema as unknown as Record<string, unknown>,
      schemaName: "landmark_story",
    });

    try {
      return StoryParser.parse(JSON.parse(text));
    } catch {
      return {
        found: false,
        name: "",
        area: "",
        category: "",
        headline: "",
        story: "",
        distanceHint: "",
      };
    }
  });

const StoryParser = z.object({
  found: z.boolean(),
  name: z.string(),
  area: z.string(),
  category: z.string(),
  headline: z.string(),
  story: z.string(),
  distanceHint: z.string(),
});
