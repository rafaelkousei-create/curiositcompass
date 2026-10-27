// Round 4B: keeps the screen awake while the guide runs, and lets you install the app on your phone
// with its own icon (replacing the Lovable heart). Run once from the project folder.
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

// ---------- 1. Icons ----------
const icon192 = Buffer.from([
'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',
'QmCC'
].join(""), "base64");
const icon512 = Buffer.from([
'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',
'AElFTkSuQmCC'
].join(""), "base64");

if (!fs.existsSync("public")) fs.mkdirSync("public");
fs.writeFileSync("public/icon-192.png", icon192);
fs.writeFileSync("public/icon-512.png", icon512);
fs.writeFileSync("public/apple-touch-icon.png", icon192);

// favicon.ico: an ICO file that wraps the 192 px PNG
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(192, 6);
header.writeUInt8(192, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(icon192.length, 14);
header.writeUInt32LE(22, 18);
fs.writeFileSync("public/favicon.ico", Buffer.concat([header, icon192]));
log("written   public/icon-192.png, icon-512.png, apple-touch-icon.png, favicon.ico");

// ---------- 2. Web app manifest ----------
const manifest = {
  name: "Wayfarer - landmark stories as you travel",
  short_name: "Wayfarer",
  description: "A hands-free audio guide that tells the story of the places around you.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#0f1424",
  theme_color: "#0f1424",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};
fs.writeFileSync("public/manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");
log("written   public/manifest.webmanifest");

// ---------- 3. src/routes/__root.tsx ----------
edit("src/routes/__root.tsx", (t) => {
  t = swap(t,
    '      { name: "viewport", content: "width=device-width, initial-scale=1" },',
    '      { name: "viewport", content: "width=device-width, initial-scale=1" },\n      { name: "theme-color", content: "#0f1424" },', "viewport line");
  t = swap(t,
    '      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },',
    [
      '      { rel: "icon", href: "/favicon.ico", sizes: "any" },',
      '      { rel: "icon", href: "/icon-192.png", type: "image/png" },',
      '      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },',
      '      { rel: "manifest", href: "/manifest.webmanifest" },',
    ].join("\n"), "icon link");
  return t;
});

// ---------- 4. src/routes/index.tsx: keep the screen awake ----------
const wakeLock = [
'  const on = status !== "off";',
'',
'  // Keep the screen awake while the guide runs, so GPS and narration are not cut off.',
'  useEffect(() => {',
'    if (!on || !("wakeLock" in navigator)) return;',
'    let lock: WakeLockSentinel | null = null;',
'    let cancelled = false;',
'    const acquire = async () => {',
'      try {',
'        const sentinel = await navigator.wakeLock.request("screen");',
'        if (cancelled) {',
'          void sentinel.release();',
'          return;',
'        }',
'        lock = sentinel;',
'      } catch {',
'        /* not allowed right now */',
'      }',
'    };',
'    const onVisible = () => {',
'      if (document.visibilityState === "visible") void acquire();',
'    };',
'    void acquire();',
'    document.addEventListener("visibilitychange", onVisible);',
'    return () => {',
'      cancelled = true;',
'      document.removeEventListener("visibilitychange", onVisible);',
'      void lock?.release().catch(() => undefined);',
'    };',
'  }, [on]);',
].join("\n");

edit("src/routes/index.tsx", (t) => swap(t, '  const on = status !== "off";', wakeLock, "the line that defines on"));

log(problems ? `\nDone with ${problems} problem(s). Copy the PROBLEM lines above and send them to me.` : "\nDone. No problems.");
