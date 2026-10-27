// Round 1: improves "Ask about a place". Run once from the project folder.
import fs from "node:fs";

const log = (m) => console.log(m);
let problems = 0;

function edit(file, fn) {
  if (!fs.existsSync(file)) { log(`PROBLEM: ${file} not found`); problems++; return; }
  const raw = fs.readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  const before = raw.replace(/\r\n/g, "\n");
  const after = fn(before);
  if (after === before) { log(`unchanged ${file}`); return; }
  fs.writeFileSync(file, crlf ? after.replace(/\n/g, "\r\n") : after);
  log(`edited    ${file}`);
}
function swap(text, find, replace, label) {
  if (!text.includes(find)) { log(`PROBLEM: could not find ${label}`); problems++; return text; }
  return text.replace(find, () => replace);
}

// ---------- 1. src/lib/landmark.functions.ts ----------
const newDescribe = [
'const DescribeInput = z.object({',
'  lat: z.number(),',
'  lng: z.number(),',
'  description: z.string().min(2).max(400),',
'  mode: z.enum(["driving", "walking"]).default("driving"),',
'});',
'',
'export const describeNearby = createServerFn({ method: "POST" })',
'  .inputValidator((input: unknown) => DescribeInput.parse(input))',
'  .handler(async ({ data }): Promise<LandmarkStory> => {',
'    // Real places around the person, so the AI can match their words to something that exists.',
'    const candidates = await findCandidates(data.lat, data.lng, [], 15);',
'',
'    const instructions = [',
'      "You are a warm, knowledgeable local guide.",',
'      data.mode === "driving"',
'        ? "The person is in a car and cannot look at a screen."',
'        : "The person is on foot.",',
'      "They ask about something near their position. It may be a description of what they can see,",',
'      "the name of a place, or a question.",',
'      "You are given REAL places near them, with notes from Wikipedia and distances in metres.",',
'      "First try to match what they said to one of those places and choose the best match.",',
'      "If they name or clearly mean a specific well-known place that is not in the list, you may",',
'      "answer from your own reliable knowledge.",',
'      "If they ask for a specific fact, include the answer in the story.",',
'      "If you cannot match their words with reasonable confidence, set found to false and leave",',
'      "the other text fields as empty strings.",',
'      "story: 70-130 words of spoken narration - vivid and factual, never invent dates, names or",',
'      "numbers, no greetings, no mention of coordinates or GPS, ready to be read aloud.",',
'      "name: the place name. headline: max 8 words. area: the neighbourhood, town or city.",',
'      "category: e.g. Historic church.",',
'      "distanceHint: a short spoken cue like about 300 metres from you.",',
'      "lat/lng: the coordinates of the place (copy them from the list when you chose from it).",',
'    ].join(" ");',
'',
'    const input = [',
'      `Listener position: ${data.lat}, ${data.lng}`,',
'      `They said: ${data.description}`,',
'      candidates.length > 0',
'        ? "Real places nearby:"',
'        : "No nearby places were found in the database.",',
'      ...candidates.map(',
'        (p, i) =>',
'          `${i + 1}. ${p.title} | ${p.distance} metres away | lat ${p.lat}, lng ${p.lng} | notes: ${p.notes}`,',
'      ),',
'    ].join("\\n");',
'',
'    return askForStory(instructions, input);',
'  });',
'',
].join("\n");

edit("src/lib/landmark.functions.ts", (t) => {
  t = swap(
    t,
    "async function findCandidates(lat: number, lng: number, heard: string[]): Promise<Place[]> {",
    "async function findCandidates(\n  lat: number,\n  lng: number,\n  heard: string[],\n  limit = 8,\n): Promise<Place[]> {",
    "findCandidates",
  );
  t = swap(t, "return places.slice(0, 8);", "return places.slice(0, limit);", "places.slice");
  const i = t.indexOf("const DescribeInput = z.object({");
  if (i < 0) { log("PROBLEM: could not find DescribeInput"); problems++; return t; }
  return t.slice(0, i) + newDescribe;
});

// ---------- 2. src/routes/index.tsx ----------
const formBlock = [
'        <form',
'          className="mt-2 flex gap-2"',
'          onSubmit={(event) => {',
'            event.preventDefault();',
'            unlockAudio();',
'            void runDescribed(ask);',
'          }}',
'        >',
'          <input',
'            value={ask}',
'            onChange={(event) => setAsk(event.target.value)}',
'            placeholder="Or type: what is that tall building?"',
'            maxLength={400}',
'            disabled={asking || recording}',
'            className="h-11 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-sm disabled:opacity-60"',
'          />',
'          <button',
'            type="submit"',
'            aria-label="Ask"',
'            disabled={asking || recording || ask.trim().length < 2}',
'            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"',
'          >',
'            <Send className="size-4" />',
'          </button>',
'        </form>',
].join("\n");

edit("src/routes/index.tsx", (t) => {
  t = swap(t, "  Radio,\n  SkipForward,", "  Radio,\n  Send,\n  SkipForward,", "lucide import");
  t = swap(
    t,
    '        {ask && !recording ? (\n          <p className="mt-2 truncate text-center text-xs text-muted-foreground">“{ask}”</p>\n        ) : null}',
    formBlock,
    "the line that shows the spoken question",
  );
  return t;
});

// ---------- 3. src/lib/transcribe.ts ----------
edit("src/lib/transcribe.ts", (t) => {
  t = swap(
    t,
    '  if (!res.ok || !res.body) {\n    const detail = await res.text().catch(() => "");\n    throw new Error(detail || `Couldn\'t understand that (${res.status})`);\n  }\n',
    [
      '  if (!res.ok || !res.body) {',
      '    const detail = await res.text().catch(() => "");',
      '    if (res.status === 401 || res.status === 403) {',
      '      throw new Error("The voice service rejected the key. Check OPENAI_API_KEY.");',
      '    }',
      '    if (res.status === 429) {',
      '      throw new Error("The voice service is busy or out of credit. Try again shortly.");',
      '    }',
      '    if (detail && !detail.trim().startsWith("{")) throw new Error(detail);',
      '    throw new Error(`Could not turn your voice into text (error ${res.status}).`);',
      '  }',
      '',
      '  // Some responses come back as plain JSON instead of a stream.',
      '  if ((res.headers.get("content-type") ?? "").includes("application/json")) {',
      '    const json = (await res.json().catch(() => ({}))) as { text?: string };',
      '    return (json.text ?? "").trim();',
      '  }',
      '',
    ].join("\n"),
    "the transcription error handling",
  );
  return t;
});

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");