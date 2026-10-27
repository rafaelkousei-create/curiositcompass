// Round 2: photos, "Read more" link and an expandable story card. Run once from the project folder.
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
const withMedia = [
'/** Adds the photo and Wikipedia link of the place the AI chose, matched by name or position. */',
'function withMedia(story: LandmarkStory, places: Place[]): LandmarkStory {',
'  if (!story.found) return story;',
'  const name = story.name.trim().toLowerCase();',
'  let match = places.find((p) => p.title.toLowerCase() === name);',
'  if (!match && name) {',
'    match = places.find(',
'      (p) => p.title.toLowerCase().includes(name) || name.includes(p.title.toLowerCase()),',
'    );',
'  }',
'  if (!match && (story.lat !== 0 || story.lng !== 0)) {',
'    match = places.find((p) => metresBetween(story.lat, story.lng, p.lat, p.lng) < 60);',
'  }',
'  return match ? { ...story, image: match.image, url: match.url } : story;',
'}',
'',
'/* ---------- Server functions ---------- */',
].join("\n");

edit("src/lib/landmark.functions.ts", (t) => {
  t = swap(t, "  lat: number;\n  lng: number;\n};\n\nconst StoryParser",
    "  lat: number;\n  lng: number;\n  image: string;\n  url: string;\n};\n\nconst StoryParser", "LandmarkStory type");
  t = swap(t, "  lat: z.number().default(0),\n  lng: z.number().default(0),\n});",
    "  lat: z.number().default(0),\n  lng: z.number().default(0),\n  image: z.string().default(\"\"),\n  url: z.string().default(\"\"),\n});", "StoryParser");
  t = swap(t, "  lat: 0,\n  lng: 0,\n};\n\nasync function askForStory",
    "  lat: 0,\n  lng: 0,\n  image: \"\",\n  url: \"\",\n};\n\nasync function askForStory", "EMPTY_STORY");
  t = swap(t, "  notes: string;\n};", "  notes: string;\n  image: string;\n  url: string;\n};", "Place type");
  t = swap(t, "  coordinates?: { lat: number; lon: number }[];\n};",
    "  coordinates?: { lat: number; lon: number }[];\n  thumbnail?: { source: string };\n  fullurl?: string;\n};", "WikiPage type");
  t = swap(t, '    prop: "extracts|coordinates",',
    '    prop: "extracts|coordinates|pageimages|info",\n    piprop: "thumbnail",\n    pithumbsize: "640",\n    inprop: "url",', "Wikipedia parameters");
  t = swap(t, 'notes: page.extract.replace(/\\s+/g, " ").trim(),',
    'notes: page.extract.replace(/\\s+/g, " ").trim(),\n        image: page.thumbnail?.source ?? "",\n        url: page.fullurl ?? "",', "place notes");
  t = swap(t, "/* ---------- Server functions ---------- */", withMedia, "server functions marker");
  t = swap(t, "if (story.found && story.story) return story;",
    "if (story.found && story.story) return withMedia(story, candidates);", "grounded return");
  const key = "return askForStory(instructions, input);";
  const i = t.lastIndexOf(key);
  if (i < 0) { log("PROBLEM: could not find the Ask return"); problems++; return t; }
  return t.slice(0, i) + "return withMedia(await askForStory(instructions, input), candidates);" + t.slice(i + key.length);
});

// ---------- 2. src/routes/index.tsx ----------
edit("src/routes/index.tsx", (t) => {
  t = swap(t, "  Crosshair,\n  History,", "  Crosshair,\n  ExternalLink,\n  History,", "lucide import");
  t = swap(t, "  const [recenterKey, setRecenterKey] = useState(0);",
    "  const [recenterKey, setRecenterKey] = useState(0);\n  const [expanded, setExpanded] = useState(false);\n  useEffect(() => {\n    setExpanded(false);\n  }, [story]);", "recenter state");
  t = swap(t,
    '              <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">\n                {story.category} · {story.area}',
    [
      '              {story.image ? (',
      '                <img',
      '                  src={story.image}',
      '                  alt={story.name}',
      '                  loading="lazy"',
      '                  className="mb-3 h-32 w-full rounded-xl object-cover sm:h-44"',
      '                />',
      '              ) : null}',
      '              <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">',
      '                {story.category} · {story.area}',
    ].join("\n"), "story card heading");
  t = swap(t,
    '              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:line-clamp-3">\n                {story.story}\n              </p>',
    [
      '              <p',
      '                className={`mt-2 text-sm leading-relaxed text-muted-foreground ${expanded ? "" : "line-clamp-3"}`}',
      '              >',
      '                {story.story}',
      '              </p>',
      '              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">',
      '                <button',
      '                  type="button"',
      '                  onClick={() => setExpanded((value) => !value)}',
      '                  className="font-medium text-primary"',
      '                >',
      '                  {expanded ? "Show less" : "Read full story"}',
      '                </button>',
      '                {story.url ? (',
      '                  <a',
      '                    href={story.url}',
      '                    target="_blank"',
      '                    rel="noreferrer"',
      '                    className="inline-flex items-center gap-1 text-muted-foreground underline"',
      '                  >',
      '                    Wikipedia <ExternalLink className="size-3.5" />',
      '                  </a>',
      '                ) : null}',
      '              </div>',
    ].join("\n"), "story text");
  return t;
});

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");