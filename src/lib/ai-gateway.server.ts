export function requireOpenAiKey() {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("Missing OPENAI_API_KEY");
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

/** Asks OpenAI for JSON that matches `schema`; returns it as a JSON string. */
export async function generateStructuredText(options: {
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  schemaName: string;
}) {
  const key = requireOpenAiKey();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: options.instructions },
        { role: "user", content: options.input },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: options.schemaName, strict: true, schema: options.schema },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`AI request failed [${response.status}]: ${detail}`);
    if (response.status === 429) {
      throw new Error("Too many requests, or the OpenAI credit is used up. Try again shortly.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("The AI key is missing or not allowed.");
    }
    if (response.status >= 500) {
      throw new Error("The story service is having a moment. Please try again.");
    }
    throw new Error("Couldn't write a story for this spot right now.");
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  return data.choices?.[0]?.message?.content ?? "{}";
}