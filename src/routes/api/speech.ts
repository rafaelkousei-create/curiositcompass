import { createFileRoute } from "@tanstack/react-router";

import { requireOpenAiKey } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/speech")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) return new Response("Missing text", { status: 400 });

        const key = requireOpenAiKey();

        try {
          const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini-tts",
              input: text.slice(0, 3500),
              voice: "alloy",
              instructions:
                "Speak as a calm, friendly tour guide riding along in the car: unhurried, clear, curious, never salesy.",
              stream_format: "sse",
              response_format: "pcm",
            }),
            signal: request.signal,
          });

          if (!response.ok || !response.body) {
            const detail = await response.text().catch(() => "");
            console.error(`TTS failed [${response.status}]: ${detail}`);
            return new Response(detail || "Narration failed", { status: response.status });
          }

          return new Response(response.body, {
            headers: { "Content-Type": "text/event-stream" },
          });
        } catch (error) {
          const name = (error as { name?: string } | null)?.name;
          if (request.signal.aborted || name === "AbortError" || name === "TimeoutError") {
            return new Response(null, { status: 499 });
          }
          console.error("TTS request error:", error);
          return new Response("Narration failed", { status: 502 });
        }
      },
    },
  },
});