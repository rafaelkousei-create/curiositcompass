import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { coordinates, landmarkAt } from "../landmark";

export default defineTool({
  name: "identify_place", title: "Identify a described place",
  description: "Match a description to a real place near caller-supplied coordinates and generate its story; uses app AI credits.",
  inputSchema: { ...coordinates, description: z.string().min(2).max(400).describe("Visible details of the place to identify.") },
  annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: false },
  handler: async ({ lat, lng, description }) => {
    const result = await landmarkAt(lat, lng, description);
    return { content: [{ type: "text", text: result.found ? `${result.name} — ${result.story}` : "No confident match; provide more visible details." }], structuredContent: { ...result } };
  },
});