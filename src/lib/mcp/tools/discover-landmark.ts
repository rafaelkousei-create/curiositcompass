import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { coordinates, landmarkAt } from "../landmark";

export default defineTool({
  name: "discover_landmark", title: "Discover a nearby landmark",
  description: "Generate a factual landmark story near coordinates supplied by the caller; does not read the browser's GPS or history.",
  inputSchema: { ...coordinates, heard: z.array(z.string().max(200)).max(40).default([]).describe("Names of landmarks to exclude.") },
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
  handler: async ({ lat, lng, heard }) => {
    const result = await landmarkAt(lat, lng, undefined, heard);
    return { content: [{ type: "text", text: result.found ? `${result.name} — ${result.story}` : "No landmark confidently identified nearby." }], structuredContent: { ...result } };
  },
});