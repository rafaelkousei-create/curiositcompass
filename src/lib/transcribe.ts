/** Microphone recorder that captures PCM and encodes a complete 16 kHz mono WAV. */
export type Recorder = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

function encodeWav(chunks: Float32Array[], sourceRate: number): Blob {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const targetRate = 16000;
  const ratio = sourceRate / targetRate;
  const outLength = Math.max(1, Math.floor(merged.length / ratio));
  const samples = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const value = merged[Math.floor(i * ratio)] ?? 0;
    const clamped = Math.max(-1, Math.min(1, value));
    samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (pos: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(pos + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(buffer, 44).set(samples);

  return new Blob([buffer], { type: "audio/wav" });
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  node.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(node);
  node.connect(ctx.destination);

  const teardown = () => {
    node.onaudioprocess = null;
    stream.getTracks().forEach((track) => track.stop());
    node.disconnect();
    source.disconnect();
  };

  return {
    stop: async () => {
      teardown();
      const blob = encodeWav(chunks, ctx.sampleRate);
      await ctx.close().catch(() => {});
      return blob;
    },
    cancel: () => {
      teardown();
      void ctx.close().catch(() => {});
    },
  };
}

/** Uploads a WAV recording and returns the transcript text. */
export async function transcribe(blob: Blob): Promise<string> {
  if (blob.size < 2048) throw new Error("That recording was empty — please try again.");

  const form = new FormData();
  form.append("file", blob, "recording.wav");

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error("The voice service rejected the key. Check OPENAI_API_KEY.");
    }
    if (res.status === 429) {
      throw new Error("The voice service is busy or out of credit. Try again shortly.");
    }
    if (detail && !detail.trim().startsWith("{")) throw new Error(detail);
    throw new Error(`Could not turn your voice into text (error ${res.status}).`);
  }

  // Some responses come back as plain JSON instead of a stream.
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const json = (await res.json().catch(() => ({}))) as { text?: string };
    return (json.text ?? "").trim();
  }

  const reader = (
    res.body as unknown as { pipeThrough: (t: TextDecoderStream) => ReadableStream<string> }
  )
    .pipeThrough(new TextDecoderStream())
    .getReader();

  let buffer = "";
  let text = "";
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
      let payload: { type?: string; delta?: string; text?: string };
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (payload.type === "transcript.text.delta" && payload.delta) text += payload.delta;
      if (payload.type === "transcript.text.done" && payload.text) text = payload.text;
    }
  }
  return text.trim();
}
