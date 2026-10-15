/** Streams narration audio from /api/speech and plays it as it arrives. */
let shared: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!shared || shared.state === "closed") {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    shared = new AudioCtx({ sampleRate: 24000 });
  }
  return shared;
}

/** Call from a tap handler so the browser allows later automatic playback. */
export function unlockAudio() {
  const ctx = getCtx();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, 24000);
  src.connect(ctx.destination);
  src.start();
}

export async function speak(text: string, signal?: AbortSignal): Promise<void> {
  const ctx = getCtx();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const out = ctx.createGain();
  out.connect(ctx.destination);
  // Cut off any already-scheduled audio the instant narration is cancelled.
  signal?.addEventListener("abort", () => {
    out.disconnect();
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
    source.connect(out);
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
  } catch (error) {
    // Skipping or stopping narration aborts the request on purpose — not an error.
    if (signal?.aborted || (error as { name?: string } | null)?.name === "AbortError") return;
    throw error;
  } finally {
    out.disconnect();
  }
}
