import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, History, Loader2, MapPin, Radio, SkipForward, Volume2 } from "lucide-react";

import { getNearbyStory, type LandmarkStory } from "@/lib/landmark.functions";
import { speak } from "@/lib/speech";

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

  const [status, setStatus] = useState<Status>("off");
  const [story, setStory] = useState<LandmarkStory | null>(null);
  const [history, setHistory] = useState<LandmarkStory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);

  const watchRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastPointRef = useRef<[number, number] | null>(null);
  const heardRef = useRef<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

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
          data: { lat: point[0], lng: point[1], heard: heardRef.current, mode: "driving" },
        });
        if (!runningRef.current) return;
        if (!result.found || !result.story) {
          setStatus("listening");
          return;
        }
        heardRef.current = [...heardRef.current, result.name].slice(-40);
        setStory(result);
        setHistory((prev) => [result, ...prev].slice(0, 30));
        setStatus("speaking");
        const controller = new AbortController();
        abortRef.current = controller;
        await speak(`${result.headline}. ${result.distanceHint}. ${result.story}`, controller.signal);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        abortRef.current = null;
        busyRef.current = false;
        if (runningRef.current) setStatus("listening");
      }
    },
    [fetchStory],
  );

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

  const on = status !== "off";
  const label: Record<Status, string> = {
    off: "Guide is off",
    waiting: "Finding you…",
    listening: "Listening to the road",
    thinking: "Looking up what's around you",
    speaking: "Telling you the story",
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-5 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Compass className="size-5 text-primary" />
          <span className="font-display text-lg font-semibold tracking-tight">Wayfarer</span>
        </div>
        <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
          Driving mode
        </span>
      </header>

      <section className="surface rounded-3xl p-7">
        <h1 className="text-3xl leading-tight font-semibold text-glow sm:text-4xl">
          Every place you pass has a story.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Leave it running on the passenger seat. Wayfarer follows your GPS and, whenever something
          worth knowing appears, it simply starts talking.
        </p>

        <div className="mt-7 flex flex-col items-center gap-5">
          <button
            onClick={on ? stop : start}
            className="relative grid size-36 place-items-center rounded-full border border-border bg-secondary transition-transform active:scale-95"
          >
            {on ? (
              <span className="pulse-ring absolute inset-0 rounded-full border-2 border-primary" />
            ) : null}
            <span className="flex flex-col items-center gap-1">
              {status === "thinking" ? (
                <Loader2 className="size-8 animate-spin text-primary" />
              ) : status === "speaking" ? (
                <Volume2 className="size-8 text-primary" />
              ) : (
                <Radio className={on ? "size-8 text-primary" : "size-8 text-muted-foreground"} />
              )}
              <span className="font-display text-sm font-semibold">{on ? "Stop" : "Start"}</span>
            </span>
          </button>

          <p className="text-sm text-muted-foreground">{label[status]}</p>

          {on ? (
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              {coords ? (
                <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1">
                  <MapPin className="size-3" />
                  {coords[0].toFixed(4)}, {coords[1].toFixed(4)}
                </span>
              ) : null}
              {speed !== null ? (
                <span className="rounded-full bg-muted px-3 py-1">
                  {Math.round(speed * 3.6)} km/h
                </span>
              ) : null}
              <button
                onClick={() => coords && void runStory(coords)}
                disabled={status === "thinking" || status === "speaking"}
                className="flex items-center gap-1 rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground disabled:opacity-40"
              >
                <Radio className="size-3" />
                Tell me something now
              </button>
              <button
                onClick={() => coords && void runStory(coords, true)}
                disabled={!coords}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1 font-medium disabled:opacity-40"
              >
                <SkipForward className="size-3" />
                Skip · next place
              </button>
            </div>
          ) : null}

          {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
        </div>
      </section>

      {story ? (
        <section className="surface rounded-3xl p-7">
          <p className="text-xs tracking-[0.18em] text-primary uppercase">
            {story.category} · {story.area}
          </p>
          <h2 className="mt-2 text-2xl font-semibold">{story.name}</h2>
          <p className="mt-1 text-sm text-accent">{story.distanceHint}</p>
          <p className="mt-4 leading-relaxed text-foreground/90">{story.story}</p>
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
            className="mt-5 flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm"
          >
            <Volume2 className="size-4" /> Play again
          </button>
        </section>
      ) : null}

      {history.length > 1 ? (
        <section className="surface rounded-3xl p-7">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <History className="size-4 text-primary" /> Along the way
          </h2>
          <ul className="mt-4 space-y-3">
            {history.slice(1).map((item, index) => (
              <li key={`${item.name}-${index}`} className="border-t border-border pt-3 text-sm">
                <p className="font-medium">{item.name}</p>
                <p className="text-muted-foreground">{item.headline}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Keep your eyes on the road — Wayfarer is made to be listened to, not looked at.
      </p>
    </main>
  );
}
