import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  Compass,
  Crosshair,
  ExternalLink,
  History,
  Info,
  Loader2,
  MapPin,
  Menu,
  Mic,
  Radio,
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
import {
  describeNearby,
  getNearbyPlaces,
  getNearbyStory,
  type LandmarkStory,
  type NearbyPlace,
} from "@/lib/landmark.functions";
import { pauseAudio, resumeAudio, speak, unlockAudio } from "@/lib/speech";
import { startRecording, transcribe, type Recorder } from "@/lib/transcribe";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Curiosity Compass — hands-free landmark stories while you drive" },
      {
        name: "description",
        content:
          "Turn on Curiosity Compass, drive, and hear the story of every landmark you pass — spoken aloud, no tapping.",
      },
      { property: "og:title", content: "Curiosity Compass — hands-free landmark stories while you drive" },
      {
        property: "og:description",
        content:
          "Turn on Curiosity Compass, drive, and hear the story of every landmark you pass — spoken aloud, no tapping.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Status = "off" | "waiting" | "listening" | "thinking" | "speaking";

const TRIGGER_METRES = 450;

// The name shown on screen. Change it here.
const APP_NAME = "Curiosity Compass";

function formatDistance(metres: number) {
  return metres < 1000
    ? `${Math.max(10, Math.round(metres / 10) * 10)} m`
    : `${(metres / 1000).toFixed(1)} km`;
}

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
  const fetchPlaces = useServerFn(getNearbyPlaces);


  const [status, setStatus] = useState<Status>("off");
  const [story, setStory] = useState<LandmarkStory | null>(null);
  const [history, setHistory] = useState<LandmarkStory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [ask, setAsk] = useState("");
  const [recording, setRecording] = useState(false);
  const [asking, setAsking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [narration, setNarration] = useState(true);
  const [paused, setPaused] = useState(false);
  const [recenterKey, setRecenterKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [story]);
  const [mode, setMode] = useState<"driving" | "walking">("driving");
  const [language, setLanguage] = useState<"en" | "el">("en");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const modeRef = useRef<"driving" | "walking">("driving");
  const languageRef = useRef<"en" | "el">("en");
  useEffect(() => {
    modeRef.current = mode;
    languageRef.current = language;
  }, [mode, language]);
  // Remember settings and the places already heard between visits.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("compass-history");
      if (saved) {
        const items = JSON.parse(saved) as LandmarkStory[];
        if (Array.isArray(items)) {
          setHistory(items.slice(0, 30));
          heardRef.current = items.map((item) => item.name).reverse();
        }
      }
      const savedMode = localStorage.getItem("compass-mode");
      if (savedMode === "walking" || savedMode === "driving") setMode(savedMode);
      const savedLanguage = localStorage.getItem("compass-language");
      if (savedLanguage === "el" || savedLanguage === "en") setLanguage(savedLanguage);
    } catch {
      /* storage unavailable */
    }
    setPrefsLoaded(true);
  }, []);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem("compass-history", JSON.stringify(history));
      localStorage.setItem("compass-mode", mode);
      localStorage.setItem("compass-language", language);
    } catch {
      /* storage unavailable */
    }
  }, [history, mode, language, prefsLoaded]);
  const [interests, setInterests] = useState<string[]>([]);
  const [interestsLoaded, setInterestsLoaded] = useState(false);
  const interestsRef = useRef<string[]>([]);
  useEffect(() => {
    interestsRef.current = interests;
  }, [interests]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("compass-interests");
      if (saved) {
        const list = JSON.parse(saved) as unknown;
        if (Array.isArray(list)) {
          setInterests(list.filter((item): item is string => typeof item === "string").slice(0, 8));
        }
      }
    } catch {
      /* storage unavailable */
    }
    setInterestsLoaded(true);
  }, []);
  useEffect(() => {
    if (!interestsLoaded) return;
    try {
      localStorage.setItem("compass-interests", JSON.stringify(interests));
    } catch {
      /* storage unavailable */
    }
  }, [interests, interestsLoaded]);
  // Real places around you, shown as pins on the map.
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const placesPointRef = useRef<[number, number] | null>(null);
  const placesLanguageRef = useRef("");
  useEffect(() => {
    if (!coords || !prefsLoaded) return;
    const last = placesPointRef.current;
    if (last && placesLanguageRef.current === language && distance(last, coords) < 400) return;
    placesPointRef.current = coords;
    placesLanguageRef.current = language;
    fetchPlaces({ data: { lat: coords[0], lng: coords[1], language } })
      .then(setPlaces)
      .catch(() => undefined);
  }, [coords, language, prefsLoaded, fetchPlaces]);
  const recorderRef = useRef<Recorder | null>(null);
  const narrationRef = useRef(true);


  const watchRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastPointRef = useRef<[number, number] | null>(null);
  const heardRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const runIdRef = useRef(0);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordsRef = useRef<[number, number] | null>(null);
  const runStoryRef = useRef<((p: [number, number], f?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);

  const narrate = useCallback(async (text: string) => {
    if (!narrationRef.current) return;
    setStatus("speaking");
    setPaused(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await speak(text, controller.signal);
    } finally {
      abortRef.current = null;
      setPaused(false);
    }
  }, []);

  const runStory = useCallback(
    async (point: [number, number], force = false) => {
      if (force) {
        abortRef.current?.abort();
        abortRef.current = null;
        busyRef.current = false;
      }
      if (busyRef.current) return;
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
      const run = ++runIdRef.current;
      busyRef.current = true;
      lastPointRef.current = point;
      setStatus("thinking");
      setError(null);
      let delay = 30000;
      try {
        const result = await fetchStory({
          data: {
            lat: point[0],
            lng: point[1],
            heard: heardRef.current,
            mode: modeRef.current,
            language: languageRef.current,
            interests: interestsRef.current,
          },
        });
        if (run !== runIdRef.current) return;
        if (!runningRef.current && !force) return;
        if (!result.found || !result.story) {
          setStatus(runningRef.current ? "listening" : "off");
          return;
        }
        heardRef.current = [...heardRef.current, result.name].slice(-40);
        setStory(result);
        setHistory((prev) => [result, ...prev].slice(0, 30));
        await narrate(`${result.headline}. ${result.distanceHint}. ${result.story}`);
        delay = 1500;
      } catch (err) {
        if (run !== runIdRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        if (run === runIdRef.current) {
          abortRef.current = null;
          busyRef.current = false;
          setStatus(runningRef.current ? "listening" : "off");
          // Keep going on our own until the user presses Stop.
          if (runningRef.current) {
            nextTimerRef.current = setTimeout(() => {
              nextTimerRef.current = null;
              const here = coordsRef.current;
              if (runningRef.current && here) void runStoryRef.current?.(here);
            }, delay);
          }
        }
      }
    },
    [fetchStory, narrate],
  );
  runStoryRef.current = runStory;

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
          data: {
            lat: point[0],
            lng: point[1],
            description: text,
            mode: modeRef.current,
            language: languageRef.current,
            interests: interestsRef.current,
          },
        });
        if (!result.found || !result.story) {
          setError("I couldn't find anything useful about that — try saying it a different way.");
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
    [asking, currentPoint, fetchDescribed, narrate],
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
      // Fresh question: forget the previous search and stop any narration.
      setError(null);
      setAsk("");
      runIdRef.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      busyRef.current = false;
      setStatus(runningRef.current ? "listening" : "off");
      recorderRef.current = await startRecording();
      setRecording(true);
    } catch {
      setError("Microphone access is needed to describe what you see.");
    }
  }, [runDescribed]);


  const stop = useCallback(() => {
    runningRef.current = false;
    if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    nextTimerRef.current = null;
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
    unlockAudio();
    runningRef.current = true;
    setError(null);
    setStatus("waiting");
    lastPointRef.current = null;
    if (coords) void runStory(coords);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const point: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setCoords(point);
        setSpeed(typeof pos.coords.speed === "number" ? pos.coords.speed : null);
        if (!runningRef.current) return;
        setStatus((prev) => (prev === "waiting" ? "listening" : prev));
        const last = lastPointRef.current;
        if (!last || distance(last, point) > (modeRef.current === "walking" ? 120 : TRIGGER_METRES)) void runStory(point);
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
  }, [coords, runStory]);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords([pos.coords.latitude, pos.coords.longitude]),
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
    );
  }, []);

  useEffect(() => {
    narrationRef.current = narration;
  }, [narration]);

  const replay = useCallback(
    (item: LandmarkStory) => {
      abortRef.current?.abort();
      void (async () => {
        await narrate(`${item.headline}. ${item.distanceHint}. ${item.story}`);
        setStatus(runningRef.current ? "listening" : "off");
      })();
    },
    [narrate],
  );

  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("compass-welcome")) setWelcome(true);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const closeWelcome = () => {
    setWelcome(false);
    try {
      localStorage.setItem("compass-welcome", "1");
    } catch {
      /* storage unavailable */
    }
  };

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  const sectionRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [sheetH, setSheetH] = useState<number | null>(null);
  const [panelH, setPanelH] = useState(300);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPanelH(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { y: event.clientY, h: scrollRef.current?.offsetHeight ?? 0, moved: false };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) > 6) drag.moved = true;
    if (!drag.moved) return;
    const limit = Math.max(120, window.innerHeight * 0.72 - (dockRef.current?.offsetHeight ?? 150) - 28);
    setSheetH(Math.round(Math.min(limit, Math.max(0, drag.h + delta))));
  };
  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) setSheetH((current) => (current === 0 ? null : 0));
  };

  const on = status !== "off";

  // Keep the screen awake while the guide runs, so GPS and narration are not cut off.
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }
        lock = sentinel;
      } catch {
        /* not allowed right now */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
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

  const recenterMap = () => {
    if (!coords) throw new Error("Your location is not available yet.");
    setRecenterKey((prev) => prev + 1);
    setMenuOpen(false);
    return "Map recentered on your location.";
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <h1 className="sr-only">Curiosity Compass landmark audio guide</h1>
      <div className="absolute inset-0">
        <LandmarkMap
          current={coords ? { lat: coords[0], lng: coords[1] } : null}
          landmark={landmark}
          recenterKey={recenterKey}
          bottomPadding={panelH + 24}
          places={places}
          onPick={(title) => {
            unlockAudio();
            void runDescribed(`Tell me about ${title}`);
          }}
        />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-500 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 p-3 sm:gap-3 sm:p-6">
        <div className="pointer-events-auto col-start-2 flex h-10 w-fit max-w-full min-w-0 items-center gap-2.5 justify-self-start rounded-full border border-border bg-card/85 pl-1.5 pr-4 shadow-md backdrop-blur-md sm:h-11">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Compass className="size-4" />
          </span>
          <span className="shrink-0 font-display text-sm font-semibold">{APP_NAME}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {coords ? label[status] : "Finding your location…"}
          </span>
        </div>
        <div className="pointer-events-auto col-start-3 flex h-10 shrink-0 items-center rounded-full border border-border bg-card/85 px-3 shadow-md backdrop-blur-md sm:h-11">
          <MapPin className={coords ? "size-4 text-primary" : "size-4 text-muted-foreground"} />
          {speed !== null ? (
            <span className="ml-1.5 text-xs text-muted-foreground">{Math.round(speed * 3.6)} km/h</span>
          ) : null}
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="pointer-events-auto col-start-1 row-start-1 grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card/85 shadow-md backdrop-blur-md sm:size-11"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="z-1000 w-[19rem] overflow-y-auto sm:w-[21rem]">
            <SheetHeader>
              <SheetTitle className="font-display">{APP_NAME}</SheetTitle>
              <SheetDescription>Stories of the places you pass, read aloud.</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6 text-sm">
              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Guide</p>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (on) stop();
                    else start();
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md bg-secondary px-3 text-left font-medium"
                >
                  <Radio className="size-4 text-primary" />
                  {on ? "Stop guide" : "Start guide"}
                </button>
                <button
                  onClick={recenterMap}
                  disabled={!coords}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border px-3 text-left disabled:opacity-40"
                >
                  <Crosshair className="size-4 text-primary" /> Recentre map on me
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Mode</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["driving", "walking"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setMode(value)}
                      className={`flex min-h-11 items-center justify-center rounded-md border px-3 font-medium ${
                        mode === value ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {value === "driving" ? "Driving" : "Walking"}
                    </button>
                  ))}
                </div>
                <p className="pt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Language
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(["en", "el"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setLanguage(value)}
                      className={`flex min-h-11 items-center justify-center rounded-md border px-3 font-medium ${
                        language === value ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      }`}
                    >
                      {value === "en" ? "English" : "Ελληνικά"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Interests</p>
                <p className="text-xs text-muted-foreground">Pick what you enjoy. Leave empty for everything.</p>
                <div className="flex flex-wrap gap-2">
                  {["History", "Architecture", "Nature", "Myths and legends", "Art and culture", "Religion"].map((topic) => {
                    const active = interests.includes(topic);
                    return (
                      <button
                        key={topic}
                        onClick={() =>
                          setInterests((prev) => (active ? prev.filter((item) => item !== topic) : [...prev, topic]))
                        }
                        className={`rounded-full border px-3 py-1.5 text-sm ${
                          active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Voice</p>
                <button
                  onClick={() => setNarration((prev) => !prev)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border px-3 text-left"
                >
                  {narration ? (
                    <Volume2 className="size-4 text-primary" />
                  ) : (
                    <VolumeX className="size-4 text-muted-foreground" />
                  )}
                  {narration ? "Narration on" : "Narration off (text only)"}
                </button>
                <button
                  onClick={() => {
                    if (!story) return;
                    setMenuOpen(false);
                    replay(story);
                  }}
                  disabled={!story || !narration}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border px-3 text-left disabled:opacity-40"
                >
                  <Radio className="size-4 text-primary" /> Repeat last story
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Places along the way
                </p>
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing yet — start the guide.</p>
                ) : (
                  <>
                    <ul className="space-y-1">
                      {history.map((item, index) => (
                        <li key={`${item.name}-${index}`}>
                          <button
                            onClick={() => {
                              setStory(item);
                              setMenuOpen(false);
                              replay(item);
                            }}
                            className="w-full rounded-md px-2 py-2 text-left hover:bg-secondary"
                          >
                            <span className="block truncate font-medium">{item.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.headline}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => {
                        setHistory([]);
                        heardRef.current = [];
                      }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border px-3 text-left text-muted-foreground"
                    >
                      <Trash2 className="size-4" /> Clear history
                    </button>
                  </>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Info className="size-4 text-primary" /> About
                </p>
                <p>
                  {APP_NAME} follows your location and tells you the story of the landmarks around you,
                  out loud.
                </p>
                <p>Keep your eyes on the road — the guide speaks so you don't have to look.</p>
                <p>Map data © OpenStreetMap contributors.</p>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setWelcome(true);
                  }}
                  className="underline"
                >
                  Show the welcome screen again
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <section ref={sectionRef} style={sheetH === null ? undefined : { maxHeight: "none" }} className="surface absolute inset-x-0 bottom-0 z-500 mx-auto flex max-h-[62dvh] w-full max-w-4xl flex-col rounded-t-2xl border-x-0 border-b-0 sm:bottom-5 sm:max-h-[56dvh] sm:w-[calc(100%-2.5rem)] sm:rounded-lg sm:border">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drag down to show more map, drag up to read more. Tap to hide or show the story."
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setSheetH((current) => (current === 0 ? null : 0));
            }
          }}
          className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center"
        >
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/50" />
        </div>

        {/* Scrolling area: the story, nearby places and history. */}
        <div ref={scrollRef} style={sheetH === null ? undefined : { height: sheetH, flex: "none", maxHeight: "70dvh" }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 sm:px-5">
          {story ? (
            <div className="pb-3">
              <div className="flex gap-3">
                {story.image ? (
                  <img
                    src={story.image}
                    alt={story.name}
                    loading="lazy"
                    className="size-16 shrink-0 rounded-xl object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {story.category} · {story.area}
                  </p>
                  <h2 className="mt-0.5 line-clamp-2 text-lg leading-snug font-semibold">{story.name}</h2>
                  <p className="mt-0.5 text-sm font-medium text-primary">{story.distanceHint}</p>
                </div>
                <button
                  onClick={() => {
                    if (status === "speaking") {
                      if (paused) resumeAudio();
                      else pauseAudio();
                      setPaused(!paused);
                    } else {
                      unlockAudio();
                      replay(story);
                    }
                  }}
                  aria-label={status === "speaking" ? (paused ? "Continue story" : "Pause story") : "Play story again"}
                  title={status === "speaking" ? (paused ? "Continue story" : "Pause story") : "Play story again"}
                  className="grid size-11 shrink-0 place-items-center rounded-full border border-border bg-secondary text-foreground"
                >
                  {status === "speaking" && !paused ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </button>
              </div>
              <p
                className={`mt-3 text-base leading-relaxed text-foreground/90 ${expanded ? "" : "line-clamp-3"}`}
              >
                {story.story}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-5 text-sm">
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="min-h-11 font-medium text-primary"
                >
                  {expanded ? "Show less" : "Read full story"}
                </button>
                {story.url ? (
                  <a
                    href={story.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline"
                  >
                    Wikipedia <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="pb-3">
              <p className="font-display text-lg font-semibold">Every place has a story.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start the guide, or ask about a place below.
              </p>
            </div>
          )}

          {places.length > 0 ? (
            <details className="border-t border-border py-1">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <MapPin className="size-4 text-primary" /> Nearby · {places.length}
              </summary>
              <ul className="space-y-1 pb-2">
                {places.slice(0, 12).map((place) => (
                  <li key={`${place.title}-${place.lat}`}>
                    <button
                      onClick={() => {
                        unlockAudio();
                        void runDescribed(`Tell me about ${place.title}`);
                      }}
                      disabled={asking}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-secondary disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate font-medium">{place.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDistance(place.distance)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {history.length > 1 ? (
            <details className="border-t border-border py-1">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                <History className="size-4 text-primary" /> Along the way · {history.length - 1}
              </summary>
              <ul className="space-y-2 pb-2">
                {history.slice(1).map((item, index) => (
                  <li key={`${item.name}-${index}`} className="text-sm">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-muted-foreground"> · {item.headline}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        {/* Fixed controls: always in the same place, whatever the story shows. */}
        <div ref={dockRef} className="shrink-0 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {error ? (
            <p role="alert" className="mb-2 rounded-lg bg-destructive/15 px-3 py-2 text-center text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              onClick={on ? stop : start}
              aria-label={on ? "Stop guide" : "Start guide"}
              className={`relative flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full px-5 text-base font-semibold shadow-lg transition-transform active:scale-95 ${
                on ? "border border-border bg-secondary text-foreground" : "bg-primary text-primary-foreground"
              }`}
            >
              {on ? <span className="pulse-ring absolute inset-0 rounded-full border-2 border-primary" /> : null}
              {status === "thinking" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : status === "speaking" ? (
                <Volume2 className="size-5" />
              ) : (
                <Radio className="size-5" />
              )}
              {on ? "Stop guide" : "Start guide"}
            </button>
            <button
              onClick={() => {
                unlockAudio();
                if (coords) void runStory(coords, true);
              }}
              disabled={!coords}
              aria-label="Skip to the next place"
              title="Next place"
              className="flex h-14 shrink-0 items-center justify-center gap-2 rounded-full border border-border px-5 text-base font-medium disabled:opacity-40"
            >
              <SkipForward className="size-5" /> Next
            </button>
          </div>

          <form
            className="mt-2.5 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              unlockAudio();
              void runDescribed(ask);
            }}
          >
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                void toggleRecording();
              }}
              disabled={asking}
              aria-label={recording ? "Stop recording and ask" : "Ask by voice"}
              className={`grid size-12 shrink-0 place-items-center rounded-full border disabled:opacity-60 ${
                recording ? "border-destructive bg-destructive text-destructive-foreground" : "border-border"
              }`}
            >
              {recording ? <Square className="size-5" /> : <Mic className="size-5 text-primary" />}
            </button>
            <input
              value={ask}
              onChange={(event) => setAsk(event.target.value)}
              placeholder={recording ? "Listening… tap the red button to finish" : "Ask about a place…"}
              maxLength={400}
              disabled={asking || recording}
              className="h-12 min-w-0 flex-1 rounded-full border border-border bg-background px-4 text-base disabled:opacity-60"
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={asking || recording || ask.trim().length < 2}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              {asking ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            </button>
          </form>
        </div>
      </section>

      {welcome ? (
        <div
          className="fixed inset-0 z-2000 grid place-items-center bg-background/90 p-5 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Welcome"
        >
          <div className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
            <p className="font-display text-sm text-primary">{APP_NAME}</p>
            <h2 className="text-2xl font-semibold">Every place has a story.</h2>
            <p className="text-sm text-muted-foreground">
              Walk or drive, and the guide tells you about the landmarks around you, out loud.
            </p>
            <ul className="space-y-3 text-sm">
              <li>
                <span className="font-medium">Location.</span>{" "}
                <span className="text-muted-foreground">
                  Used to find places near you. It is sent to the app's server, Wikipedia and OpenAI to write
                  the story. The app does not save it.
                </span>
              </li>
              <li>
                <span className="font-medium">Sound.</span>{" "}
                <span className="text-muted-foreground">
                  Stories are read aloud. Turn the volume up, and keep your eyes on the road.
                </span>
              </li>
              <li>
                <span className="font-medium">Microphone.</span>{" "}
                <span className="text-muted-foreground">
                  Only if you tap Ask, to hear your question. You can also type it.
                </span>
              </li>
            </ul>
            <div className="space-y-2 pt-1">
              <button
                onClick={() => {
                  closeWelcome();
                  unlockAudio();
                  start();
                }}
                className="h-12 w-full rounded-full bg-primary font-semibold text-primary-foreground"
              >
                Start the guide
              </button>
              <button
                onClick={closeWelcome}
                className="h-11 w-full rounded-full border border-border text-sm font-medium"
              >
                Just look around
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
