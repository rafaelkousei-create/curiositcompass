import { createFileRoute } from "@tanstack/react-router";

import { requireOpenAiKey } from "@/lib/ai-gateway.server";

const MAX_BYTES = 12 * 1024 * 1024;

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File) || file.size < 2048) {
          return new Response("That recording was empty — please try again.", { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          return new Response("That recording is too long.", { status: 413 });
        }

        const key = requireOpenAiKey();

        const upstream = new FormData();
        upstream.append("model", "gpt-4o-mini-transcribe");
        upstream.append("file", file, "recording.wav");
        upstream.append("stream", "true");

        const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}` },
          body: upstream,
          signal: request.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          console.error(`Transcription failed [${response.status}]: ${detail}`);
          return new Response(detail || "Couldn't understand that", { status: response.status });
        }

        return new Response(response.body, {
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    },
  },
});