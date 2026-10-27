// Round 3: driving/walking mode, language (English/Greek) and saved history. Run once from the project folder.
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
function swapAll(text, find, replace, label) {
  if (!text.includes(find)) { log(`PROBLEM: could not find ${label}`); problems++; return text; }
  return text.split(find).join(replace);
}

// ---------- 1. src/lib/landmark.functions.ts ----------
edit("src/lib/landmark.functions.ts", (t) => {
  t = swapAll(t, '  mode: z.enum(["driving", "walking"]).default("driving"),\n',
    '  mode: z.enum(["driving", "walking"]).default("driving"),\n  language: z.enum(["en", "el"]).default("en"),\n', "mode fields");

  t = swap(t,
    "async function askForStory(instructions: string, input: string): Promise<LandmarkStory> {\n  const text = await generateStructuredText({\n    instructions,\n    input,",
    [
      "async function askForStory(",
      "  instructions: string,",
      "  input: string,",
      "  opts: { mode: string; language: string },",
      "): Promise<LandmarkStory> {",
      "  const tuned =",
      '    instructions.replace("70-130 words", opts.mode === "walking" ? "100-170 words" : "70-130 words") +',
      "    (opts.language === \"el\"",
      '      ? " Write headline, story, area, category and distanceHint in Greek. When you chose a place from the list, keep name exactly as in the list."',
      '      : " Write every text field in English.");',
      "  const text = await generateStructuredText({",
      "    instructions: tuned,",
      "    input,",
    ].join("\n"), "askForStory");
  t = swapAll(t, "askForStory(instructions, input)", "askForStory(instructions, input, data)", "askForStory calls");

  t = swap(t, "async function wikipediaNearby(lat: number, lng: number, radius: number): Promise<Place[]> {",
    "async function wikipediaNearby(\n  lat: number,\n  lng: number,\n  radius: number,\n  lang: string,\n): Promise<Place[]> {", "wikipediaNearby");
  t = swap(t, "https://en.wikipedia.org/w/api.php", "https://${lang}.wikipedia.org/w/api.php", "Wikipedia address");

  t = swap(t,
    "  limit = 8,\n): Promise<Place[]> {",
    '  limit = 8,\n  lang = "en",\n): Promise<Place[]> {', "findCandidates signature");
  t = swap(t,
    "  let places = fresh(await wikipediaNearby(lat, lng, 1000));\n  if (places.length === 0) places = fresh(await wikipediaNearby(lat, lng, 5000));\n  return places.slice(0, limit);",
    [
      "  // Search in the chosen language first, then in English.",
      "  const nearby = async (radius: number) => {",
      "    let found = fresh(await wikipediaNearby(lat, lng, radius, lang));",
      '    if (found.length === 0 && lang !== "en") found = fresh(await wikipediaNearby(lat, lng, radius, "en"));',
      "    return found;",
      "  };",
      "  let places = await nearby(1000);",
      "  if (places.length === 0) places = await nearby(5000);",
      "  return places.slice(0, limit);",
    ].join("\n"), "findCandidates body");
  t = swap(t, "findCandidates(data.lat, data.lng, data.heard)", "findCandidates(data.lat, data.lng, data.heard, 8, data.language)", "story lookup");
  t = swap(t, "findCandidates(data.lat, data.lng, [], 15)", "findCandidates(data.lat, data.lng, [], 15, data.language)", "ask lookup");
  return t;
});

// ---------- 2. src/routes/index.tsx ----------
const state = [
'  useEffect(() => {',
'    setExpanded(false);',
'  }, [story]);',
'  const [mode, setMode] = useState<"driving" | "walking">("driving");',
'  const [language, setLanguage] = useState<"en" | "el">("en");',
'  const [prefsLoaded, setPrefsLoaded] = useState(false);',
'  const modeRef = useRef<"driving" | "walking">("driving");',
'  const languageRef = useRef<"en" | "el">("en");',
'  useEffect(() => {',
'    modeRef.current = mode;',
'    languageRef.current = language;',
'  }, [mode, language]);',
'  // Remember settings and the places already heard between visits.',
'  useEffect(() => {',
'    try {',
'      const saved = localStorage.getItem("compass-history");',
'      if (saved) {',
'        const items = JSON.parse(saved) as LandmarkStory[];',
'        if (Array.isArray(items)) {',
'          setHistory(items.slice(0, 30));',
'          heardRef.current = items.map((item) => item.name).reverse();',
'        }',
'      }',
'      const savedMode = localStorage.getItem("compass-mode");',
'      if (savedMode === "walking" || savedMode === "driving") setMode(savedMode);',
'      const savedLanguage = localStorage.getItem("compass-language");',
'      if (savedLanguage === "el" || savedLanguage === "en") setLanguage(savedLanguage);',
'    } catch {',
'      /* storage unavailable */',
'    }',
'    setPrefsLoaded(true);',
'  }, []);',
'  useEffect(() => {',
'    if (!prefsLoaded) return;',
'    try {',
'      localStorage.setItem("compass-history", JSON.stringify(history));',
'      localStorage.setItem("compass-mode", mode);',
'      localStorage.setItem("compass-language", language);',
'    } catch {',
'      /* storage unavailable */',
'    }',
'  }, [history, mode, language, prefsLoaded]);',
].join("\n");

const settings = [
'              <div className="space-y-2">',
'                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Mode</p>',
'                <div className="grid grid-cols-2 gap-2">',
'                  {(["driving", "walking"] as const).map((value) => (',
'                    <button',
'                      key={value}',
'                      onClick={() => setMode(value)}',
'                      className={`flex min-h-11 items-center justify-center rounded-md border px-3 font-medium ${',
'                        mode === value ? "border-primary bg-primary text-primary-foreground" : "border-border"',
'                      }`}',
'                    >',
'                      {value === "driving" ? "Driving" : "Walking"}',
'                    </button>',
'                  ))}',
'                </div>',
'                <p className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">',
'                  Language',
'                </p>',
'                <div className="grid grid-cols-2 gap-2">',
'                  {(["en", "el"] as const).map((value) => (',
'                    <button',
'                      key={value}',
'                      onClick={() => setLanguage(value)}',
'                      className={`flex min-h-11 items-center justify-center rounded-md border px-3 font-medium ${',
'                        language === value ? "border-primary bg-primary text-primary-foreground" : "border-border"',
'                      }`}',
'                    >',
'                      {value === "en" ? "English" : "Ελληνικά"}',
'                    </button>',
'                  ))}',
'                </div>',
'              </div>',
'',
].join("\n");

edit("src/routes/index.tsx", (t) => {
  t = swap(t, "  useEffect(() => {\n    setExpanded(false);\n  }, [story]);", state, "expanded effect (Round 2 must be applied first)");
  t = swap(t, "data: { lat: point[0], lng: point[1], heard: heardRef.current },",
    "data: {\n            lat: point[0],\n            lng: point[1],\n            heard: heardRef.current,\n            mode: modeRef.current,\n            language: languageRef.current,\n          },", "story request");
  t = swap(t, "data: { lat: point[0], lng: point[1], description: text },",
    "data: {\n            lat: point[0],\n            lng: point[1],\n            description: text,\n            mode: modeRef.current,\n            language: languageRef.current,\n          },", "ask request");
  t = swap(t, "distance(last, point) > TRIGGER_METRES",
    'distance(last, point) > (modeRef.current === "walking" ? 120 : TRIGGER_METRES)', "trigger distance");
  t = swap(t,
    '              <div className="space-y-2">\n                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Voice</p>',
    settings + '              <div className="space-y-2">\n                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Voice</p>',
    "Voice section of the menu");
  return t;
});

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");