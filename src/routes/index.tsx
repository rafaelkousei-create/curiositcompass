import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Car,
  Compass,
  Crosshair,
  Footprints,
  History,
  Info,
  Loader2,
  MapPin,
  Menu,
  Mic,
  Radio,
  Search,
  Send,
  SkipForward,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

import { LandmarkMap } from "@/components/LandmarkMap";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { describeNearby, getNearbyStory, type LandmarkStory } from "@/lib/landmark.functions";
import { speak } from "@/lib/speech";
import { startRecording, transcribe, type Recorder } from "@/lib/transcribe";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wayfarer — hands-free landmark stories while you drive" },
      {
        name: "description",
        content:
          "Turn on Wayfarer, drive, and hear the story of every landmark you pass — spoken aloud, no tapping.",
      },
      { property: "og:title", content: "Wayfarer — hands-free landmark stories while you drive" },
      {
        property: "og:description",
        content:
          "Turn on Wayfarer, drive, and hear the story of every landmark you pass — spoken aloud, no tapping.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Status = "off" | "waiting" | "listening" | "thinking" | "speaking";

const TRIGGER_METRES = 450;

function distance(a: [number, number], b: [number, number]) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function Index() {
  const fetchStory = useServerFn(getNearbyStory);
  const fetchDescribed = useServerFn(describeNearby);


  const [status, setStatus] = useState<Status>("off");
  const [story, setStory] = useState<LandmarkStory | null>(null);
  const [history, setHistory] = useState<LandmarkStory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [recording, setRecording] = useState(false);
  const [asking, setAsking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"driving" | "walking">("driving");
  const [narration, setNarration] = useState(true);
  const [recenterKey, setRecenterKey] = useState(0);
  const recorderRef = useRef<Recorder | null>(null);
  const narrationRef = useRef(true);
  const modeRef = useRef<"driving" | "walking">("driving");


  const watchRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastPointRef = useRef<[number, number] | null>(null);
  const heardRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const narrate = useCallback(async (text: string) => {
    if (!narrationRef.current) return;
    setStatus("speaking");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await speak(text, controller.signal);
    } finally {
      abortRef.current = null;
    }
  }, []);

  const runStory = useCallback(
    async (point: [number, number], force = false) => {
      if (busyRef.current) {
        if (!force) return;
        abortRef.current?.abort();
        abortRef.current = null;
        busyRef.current = false;
      }
      busyRef.current = true;
      lastPointRef.current = point;
      setStatus("thinking");
      setError(null);
      try {
        const result = await fetchStory({
          data: { lat: point[0], lng: point[1], heard: heardRef.current, mode: modeRef.current },
        });
        if (!runningRef.current) return;
        if (!result.found || !result.story) {
          setStatus("listening");
          return;
        }
        heardRef.current = [...heardRef.current, result.name].slice(-40);
        setStory(result);
        setHistory((prev) => [result, ...prev].slice(0, 30));
        await narrate(`${result.headline}. ${result.distanceHint}. ${result.story}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        if (runningRef.current) setStatus("listening");
      }
    },
    [fetchStory, narrate],
  );

  const currentPoint = useCallback(async (): Promise<[number, number]> => {
    if (coords) return coords;
    if (!("geolocation" in navigator)) throw new Error("This device can't share its location.");
    return await new Promise<[number, number]>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        () => reject(new Error("Couldn't get your location — allow it and try again.")),
        { enableHighAccuracy: true, timeout: 20000 },
      );
    });
  }, [coords]);

  const runDescribed = useCallback(
    async (description: string) => {
      const text = description.trim();
      if (!text || asking) return;
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = true;
      setAsking(true);
      setError(null);
      setStatus("thinking");
      try {
        const point = await currentPoint();
        setCoords(point);
        const result = await fetchDescribed({
          data: { lat: point[0], lng: point[1], description: text, mode: modeRef.current },
        });
        if (!result.found || !result.story) {
          setError("I couldn't work out which place you mean — try adding a detail or two.");
          return;
        }
        heardRef.current = [...heardRef.current, result.name].slice(-40);
        setStory(result);
        setHistory((prev) => [result, ...prev].slice(0, 30));
        setAsk("");
        await narrate(`${result.headline}. ${result.distanceHint}. ${result.story}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        setAsking(false);
        setStatus(runningRef.current ? "listening" : "off");
      }
    },
    [asking, currentPoint, fetchDescribed],
  );

  const toggleRecording = useCallback(async () => {
    if (recorderRef.current) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      try {
        const blob = await recorder.stop();
        setAsking(true);
        const text = await transcribe(blob);
        setAsking(false);
        if (!text) {
          setError("I didn't catch that — try again.");
          return;
        }
        setAsk(text);
        void runDescribed(text);
      } catch (err) {
        setAsking(false);
        setError(err instanceof Error ? err.message : "Couldn't understand that");
      }
      return;
    }
    try {
      setError(null);
      recorderRef.current = await startRecording();
      setRecording(true);
    } catch {
      setError("Microphone access is needed to describe what you see.");
    }
  }, [runDescribed]);


  const stop = useCallback(() => {
    runningRef.current = false;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setStatus("off");
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("This device can't share its location.");
      return;
    }
    runningRef.current = true;
    setError(null);
    setStatus("waiting");
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setCoords(point);
        setSpeed(typeof pos.coords.speed === "number" ? pos.coords.speed : null);
        if (!runningRef.current) return;
        setStatus((prev) => (prev === "waiting" ? "listening" : prev));
        const last = lastPointRef.current;
        if (!last || distance(last, point) > TRIGGER_METRES) void runStory(point);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was blocked. Allow it to hear stories around you."
            : "Couldn't get a GPS fix yet.",
        );
        if (runningRef.current) setStatus("waiting");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [runStory]);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords([pos.coords.latitude, pos.coords.longitude]),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
    );
  }, []);

  const on = status !== "off";
  const label: Record<Status, string> = {
    off: "Guide is off",
    waiting: "Finding you…",
    listening: "Listening to the road",
    thinking: "Looking up what's around you",
    speaking: "Telling you the story",
  };

  const landmark =
    story && Number.isFinite(story.lat) && Number.isFinite(story.lng) && (story.lat !== 0 || story.lng !== 0)
      ? { lat: story.lat, lng: story.lng, name: story.name }
      : null;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <h1 className="sr-only">Wayfarer landmark audio guide</h1>
      <div className="absolute inset-0">
        <LandmarkMap
          current={coords ? { lat: coords[0], lng: coords[1] } : null}
          landmark={landmark}
        />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-500 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 sm:p-6">
        <div className="pointer-events-auto flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur-md">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Compass className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">Wayfarer</p>
            <p className="truncate text-xs text-muted-foreground">
              {coords ? label[status] : "Finding your location…"}
            </p>
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
          <MapPin className={coords ? "size-4 text-accent" : "size-4 text-muted-foreground"} />
          <span className="hidden sm:inline">{coords ? "Location found" : "Locating"}</span>
          {speed !== null ? <span className="text-muted-foreground">{Math.round(speed * 3.6)} km/h</span> : null}
        </div>
      </header>

      <section className="surface absolute inset-x-0 bottom-0 z-500 mx-auto flex max-h-[48dvh] min-h-[34dvh] w-full max-w-4xl flex-col overflow-y-auto rounded-t-2xl border-x-0 border-b-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:bottom-5 sm:max-h-[46dvh] sm:min-h-0 sm:w-[calc(100%-2.5rem)] sm:rounded-lg sm:border sm:p-5">
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/40 sm:hidden" />

        {story ? (
          <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border pb-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-primary uppercase">
                {story.category} · {story.area}
              </p>
              <h2 className="mt-1 truncate text-xl font-semibold sm:text-2xl">{story.name}</h2>
              <p className="mt-1 text-sm text-accent">{story.distanceHint}</p>
              <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:line-clamp-3">
                {story.story}
              </p>
            </div>
            <button
              onClick={() => {
                const current = story;
                void (async () => {
                  setStatus("speaking");
                  const controller = new AbortController();
                  abortRef.current = controller;
                  try {
                    await speak(current.story, controller.signal);
                  } finally {
                    abortRef.current = null;
                    setStatus(runningRef.current ? "listening" : "off");
                  }
                })();
              }}
              aria-label="Play story again"
              title="Play story again"
              className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-secondary text-foreground"
            >
              <Volume2 className="size-5" />
            </button>
          </div>
        ) : (
          <div className="mb-4 border-b border-border pb-4">
            <p className="font-display text-lg font-semibold">Every place has a story.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start the guide or describe something you can see.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
          <button
            onClick={on ? stop : start}
            aria-label={on ? "Stop guide" : "Start guide"}
            className="relative grid size-16 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 sm:size-20"
          >
            {on ? <span className="pulse-ring absolute inset-0 rounded-full border-2 border-primary" /> : null}
            {status === "thinking" ? (
              <Loader2 className="size-6 animate-spin" />
            ) : status === "speaking" ? (
              <Volume2 className="size-6" />
            ) : (
              <Radio className="size-6" />
            )}
          </button>

          <div className="grid min-w-0 grid-cols-2 gap-2">
            <button
              onClick={() => coords && void runStory(coords)}
              disabled={!coords || status === "thinking" || status === "speaking"}
              className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md bg-secondary px-3 text-sm font-medium disabled:opacity-40"
            >
              <Radio className="size-4 shrink-0 text-primary" />
              <span className="truncate">Tell me now</span>
            </button>
            <button
              onClick={() => coords && void runStory(coords, true)}
              disabled={!coords}
              className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium disabled:opacity-40"
            >
              <SkipForward className="size-4 shrink-0" />
              <span className="truncate">Next place</span>
            </button>
            <button
              onClick={() => setAskOpen((prev) => !prev)}
              className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium"
            >
              <Search className="size-4 text-primary" />
              Ask about a place
            </button>
          </div>
        </div>

        {askOpen ? (
          <div className="mt-4 border-t border-border pt-4">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
              <button
                onClick={() => void toggleRecording()}
                aria-label={recording ? "Stop recording and ask" : "Describe by voice"}
                title={recording ? "Stop and ask" : "Describe by voice"}
                className={`grid size-11 shrink-0 place-items-center rounded-full ${
                  recording ? "bg-destructive text-destructive-foreground" : "bg-secondary text-foreground"
                }`}
              >
                {recording ? <Square className="size-4" /> : <Mic className="size-5" />}
              </button>
              <input
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runDescribed(ask);
                }}
                placeholder="Describe what you see…"
                className="h-11 min-w-0 rounded-md border border-border bg-secondary px-3 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => void runDescribed(ask)}
                disabled={!ask.trim() || asking}
                aria-label="Ask"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                {asking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
            {recording ? <p className="mt-2 text-center text-xs text-accent">Listening… tap the square when finished.</p> : null}
          </div>
        ) : null}

        {error ? <p className="mt-3 text-center text-sm text-destructive">{error}</p> : null}

        {history.length > 1 ? (
          <details className="mt-3 border-t border-border pt-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <History className="size-4 text-primary" /> Along the way · {history.length - 1}
            </summary>
            <ul className="mt-3 space-y-2">
              {history.slice(1).map((item, index) => (
                <li key={`${item.name}-${index}`} className="text-sm">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground"> · {item.headline}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </main>
  );
}
