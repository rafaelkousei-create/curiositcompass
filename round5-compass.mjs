// Round 5: welcome screen, list of nearby places, labelled main buttons, and the new name
// Curiosity Compass everywhere. Run once from the project folder.
// Needs Rounds 1 to 4 to be applied first.
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

const welcomeState = [
'  const [welcome, setWelcome] = useState(false);',
'  useEffect(() => {',
'    try {',
'      if (!localStorage.getItem("compass-welcome")) setWelcome(true);',
'    } catch {',
'      /* storage unavailable */',
'    }',
'  }, []);',
'  const closeWelcome = () => {',
'    setWelcome(false);',
'    try {',
'      localStorage.setItem("compass-welcome", "1");',
'    } catch {',
'      /* storage unavailable */',
'    }',
'  };',
'',
'  const on = status !== "off";',
].join("\n");

const welcomeJsx = [
'      </section>',
'',
'      {welcome ? (',
'        <div',
'          className="fixed inset-0 z-2000 grid place-items-center bg-background/90 p-5 backdrop-blur-sm"',
'          role="dialog"',
'          aria-modal="true"',
'          aria-label="Welcome"',
'        >',
'          <div className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">',
'            <p className="font-display text-sm text-primary">{APP_NAME}</p>',
'            <h2 className="text-2xl font-semibold">Every place has a story.</h2>',
'            <p className="text-sm text-muted-foreground">',
'              Walk or drive, and the guide tells you about the landmarks around you, out loud.',
'            </p>',
'            <ul className="space-y-3 text-sm">',
'              <li>',
'                <span className="font-medium">Location.</span>{" "}',
'                <span className="text-muted-foreground">',
'                  Used to find places near you. It is sent to the app\'s server, Wikipedia and OpenAI to write',
'                  the story. The app does not save it.',
'                </span>',
'              </li>',
'              <li>',
'                <span className="font-medium">Sound.</span>{" "}',
'                <span className="text-muted-foreground">',
'                  Stories are read aloud. Turn the volume up, and keep your eyes on the road.',
'                </span>',
'              </li>',
'              <li>',
'                <span className="font-medium">Microphone.</span>{" "}',
'                <span className="text-muted-foreground">',
'                  Only if you tap Ask, to hear your question. You can also type it.',
'                </span>',
'              </li>',
'            </ul>',
'            <div className="space-y-2 pt-1">',
'              <button',
'                onClick={() => {',
'                  closeWelcome();',
'                  unlockAudio();',
'                  start();',
'                }}',
'                className="h-12 w-full rounded-full bg-primary font-semibold text-primary-foreground"',
'              >',
'                Start the guide',
'              </button>',
'              <button',
'                onClick={closeWelcome}',
'                className="h-11 w-full rounded-full border border-border text-sm font-medium"',
'              >',
'                Just look around',
'              </button>',
'            </div>',
'          </div>',
'        </div>',
'      ) : null}',
'    </main>',
].join("\n");

const nearbyJsx = [
'        {places.length > 0 ? (',
'          <details className="mt-3 border-t border-border pt-3">',
'            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">',
'              <MapPin className="size-4 text-primary" /> Nearby · {places.length}',
'            </summary>',
'            <ul className="mt-3 space-y-1">',
'              {places.slice(0, 12).map((place) => (',
'                <li key={`${place.title}-${place.lat}`}>',
'                  <button',
'                    onClick={() => {',
'                      unlockAudio();',
'                      void runDescribed(`Tell me about ${place.title}`);',
'                    }}',
'                    disabled={asking}',
'                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-secondary disabled:opacity-50"',
'                  >',
'                    <span className="min-w-0 truncate font-medium">{place.title}</span>',
'                    <span className="shrink-0 text-xs text-muted-foreground">{formatDistance(place.distance)}</span>',
'                  </button>',
'                </li>',
'              ))}',
'            </ul>',
'          </details>',
'        ) : null}',
'',
'        {history.length > 1 ? (',
].join("\n");

const controls = [
'        <div className="flex items-center gap-3">',
'          <button',
'            onClick={on ? stop : start}',
'            aria-label={on ? "Stop guide" : "Start guide"}',
'            className={`relative flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full px-5 text-base font-semibold shadow-lg transition-transform active:scale-95 ${',
'              on ? "border border-border bg-secondary text-foreground" : "bg-primary text-primary-foreground"',
'            }`}',
'          >',
'            {on ? <span className="pulse-ring absolute inset-0 rounded-full border-2 border-primary" /> : null}',
'            {status === "thinking" ? (',
'              <Loader2 className="size-5 animate-spin" />',
'            ) : status === "speaking" ? (',
'              <Volume2 className="size-5" />',
'            ) : (',
'              <Radio className="size-5" />',
'            )}',
'            {on ? "Stop guide" : "Start guide"}',
'          </button>',
'',
'          <button',
'            onClick={() => {',
'              unlockAudio();',
'              if (coords) void runStory(coords, true);',
'            }}',
'            disabled={!coords}',
'            aria-label="Skip to the next place"',
'            title="Next place"',
'            className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-4 text-sm font-medium disabled:opacity-40"',
'          >',
'            <SkipForward className="size-5" /> Next',
'          </button>',
'        </div>',
'',
].join("\n");

edit("src/routes/index.tsx", (t) => {
  t = swap(t, "const TRIGGER_METRES = 450;",
    [
      "const TRIGGER_METRES = 450;",
      "",
      "// The name shown on screen. Change it here.",
      'const APP_NAME = "Curiosity Compass";',
      "",
      "function formatDistance(metres: number) {",
      "  return metres < 1000",
      "    ? `${Math.max(10, Math.round(metres / 10) * 10)} m`",
      "    : `${(metres / 1000).toFixed(1)} km`;",
      "}",
    ].join("\n"), "TRIGGER_METRES line");

  t = swap(t, '<span className="shrink-0 font-display text-sm font-semibold">Wayfarer</span>',
    '<span className="shrink-0 font-display text-sm font-semibold">{APP_NAME}</span>', "header name");
  t = swap(t, '<SheetTitle className="font-display">Wayfarer</SheetTitle>',
    '<SheetTitle className="font-display">{APP_NAME}</SheetTitle>', "menu title");
  t = swap(t, "Wayfarer follows your location", "{APP_NAME} follows your location", "about text");

  t = swap(t, '  const on = status !== "off";', welcomeState, "the line that defines on");
  t = swap(t, "      </section>\n    </main>", welcomeJsx, "end of the page");
  t = swap(t, "        {history.length > 1 ? (", nearbyJsx, "history list");

  t = swap(t, "<p>Map data © OpenStreetMap contributors.</p>",
    '<p>Map data © OpenStreetMap contributors.</p>\n                <button\n                  onClick={() => {\n                    setMenuOpen(false);\n                    setWelcome(true);\n                  }}\n                  className="underline"\n                >\n                  Show the welcome screen again\n                </button>',
    "map credit");

  const startMarker = '        <div className="flex items-center gap-3">\n          <button\n            onClick={on ? stop : start}';
  const endMarker = '        <button\n          onClick={() => {\n            unlockAudio();\n            void toggleRecording();';
  const a = t.indexOf(startMarker);
  const b = t.indexOf(endMarker);
  if (a < 0 || b < 0 || b < a) { log("PROBLEM: could not find the Start / Next buttons"); problems++; return t; }
  return t.slice(0, a) + controls + t.slice(b);
});

// ---------- Rename everything to Curiosity Compass ----------
const NEW_NAME = "Curiosity Compass";
edit("src/routes/index.tsx", (t) => t.split("Wayfarer").join(NEW_NAME));
edit("src/routes/__root.tsx", (t) => t.split("Wayfarer").join(NEW_NAME));

if (fs.existsSync("public/manifest.webmanifest")) {
  const raw = fs.readFileSync("public/manifest.webmanifest", "utf8");
  const manifest = JSON.parse(raw);
  manifest.name = `${NEW_NAME} - landmark stories as you travel`;
  manifest.short_name = "Compass";
  fs.writeFileSync("public/manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");
  log("edited    public/manifest.webmanifest");
} else {
  log("PROBLEM: public/manifest.webmanifest not found");
  problems++;
}

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");
