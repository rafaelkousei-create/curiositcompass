/** Streams narration audio from /api/speech and plays it as it arrives. */
export async function speak(text: string, signal?: AbortSignal): Promise<void> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 24000 });
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  // Cut off any already-scheduled audio the instant narration is cancelled.
  signal?.addEventListener("abort", () => {
    if (ctx.state !== "closed") void ctx.close().catch(() => {});
  });
  if (signal?.aborted) return;

  let playhead = 0;
  let pending = new Uint8Array(0);
  let lastEnd = 0;

  const playChunk = (incoming: Uint8Array) => {
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending);
    bytes.set(incoming, pending.length);
    const usable = bytes.length - (bytes.length % 2);
    pending = bytes.slice(usable);
    if (usable === 0) return;
    const samples = new Int16Array(bytes.buffer, 0, usable / 2);
    const floats = Float32Array.from(samples, (s) => s / 32768);
    const buffer = ctx.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    if (playhead === 0) playhead = ctx.currentTime + 0.08;
    else playhead = Math.max(playhead, ctx.currentTime);
    source.start(playhead);
    playhead += buffer.duration;
    lastEnd = playhead;
  };

  try {
    const res = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: signal ?? null,
    });
    if (!res.ok || !res.body) throw new Error(`Narration failed (${res.status})`);

    const reader = (
      res.body as unknown as { pipeThrough: (t: TextDecoderStream) => ReadableStream<string> }
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
        if (!data) continue;
        let payload: { type?: string; audio?: string };
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (payload.type !== "speech.audio.delta" || !payload.audio) continue;
        const binary = atob(payload.audio);
        const chunk = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) chunk[i] = binary.charCodeAt(i);
        playChunk(chunk);
      }
    }

    const remaining = Math.max(0, lastEnd - ctx.currentTime) * 1000;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining + 150);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    await ctx.close().catch(() => {});
  }
}
