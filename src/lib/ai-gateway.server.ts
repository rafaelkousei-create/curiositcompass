const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export function requireLovableApiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

/** Reads an SSE body line by line and yields parsed `data:` payloads. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>) {
  const reader = (
    body as unknown as { pipeThrough: (t: TextDecoderStream) => ReadableStream<string> }
  )
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }
}

/**
 * Streaming call to the Lovable AI Gateway Responses API.
 * Streams on the wire (required for reasoning models) but returns the final text.
 */
export async function generateStructuredText(options: {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  schemaName: string;
}) {
  const key = requireLovableApiKey();

  const response = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: options.instructions,
      input: options.input,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: options.schemaName,
          strict: true,
          schema: options.schema,
        },
      },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    console.error(`AI request failed [${response.status}]: ${detail}`);

    if (response.status === 402) {
      throw new Error(
        "This app is out of AI credits, so new stories can't be written right now. Top up in Lovable to continue.",
      );
    }
    if (response.status === 403) {
      throw new Error("AI access is currently blocked for this workspace.");
    }
    if (response.status === 429) {
      throw new Error("Too many requests right now — give it a few seconds and try again.");
    }
    if (response.status >= 500) {
      throw new Error("The story service is having a moment. Please try again.");
    }
    throw new Error("Couldn't write a story for this spot right now.");
  }

  let text = "";
  for await (const event of readSseEvents(response.body)) {
    if (event["type"] === "response.output_text.delta" && typeof event["delta"] === "string") {
      text += event["delta"];
    }
  }
  return text;
}
