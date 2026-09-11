# Ask about what you see

Add an "Ask / describe" control to the main screen. You describe something you can see — "a big domed church on the left", "what's this bridge?" — and Wayfarer works out what it is near your current position, shows it with the map pin, and reads the story aloud like any other landmark.

## How it works for you

- A new **Ask about a place** button under the existing controls.
- Tap it and you get two ways to ask:
  - **Hold to speak** — say your description out loud, best while driving. Your words appear as text so you can see it understood you.
  - **Type it** — a short text box for when you're a passenger or on foot.
- Wayfarer uses your current GPS position plus your description to identify the most likely real place nearby.
- The answer appears in the same story card as automatic stories: name, area, category, story text, map with pin, and spoken narration.
- If it can't confidently match anything, it says so on screen instead of inventing a place.
- Asking works whether the guide is running or off (it just needs a location fix), and it interrupts any narration in progress.

## Technical notes

- New server function `describeNearby` in `src/lib/landmark.functions.ts`: input `{ lat, lng, description, mode }`, same `StorySchema` / `LandmarkStory` output so the existing card and `LandmarkMap` are reused unchanged. Instructions adapted: match the user's description to a real place near the coordinates, prefer visible landmarks, `found: false` when unsure, and populate `distanceHint` as a spoken directional cue.
- New route `src/routes/api/transcribe.ts`: accepts a `multipart/form-data` audio upload, forwards it to `https://ai.gateway.lovable.dev/v1/audio/transcriptions` with `model: google/gemini-3.5-transcribe` and `stream: "true"`, streams the SSE body back. Uses `requireLovableApiKey()` from `ai-gateway.server.ts`; rejects empty/oversized uploads.
- New client helper `src/lib/transcribe.ts`: records mic audio via Web Audio (ScriptProcessor → 16 kHz mono WAV, no MediaRecorder fragments), posts the complete WAV, parses `transcript.text.delta` / `transcript.text.done` events, returns the transcript.
- `src/routes/index.tsx`: add an `asking` UI section (mic button + text input + transcript preview), a `runDescribed(text)` handler that aborts current narration, sets status `thinking`, calls `describeNearby`, then sets story/history and calls `speak(...)` — mirroring `runStory`'s busy/abort/running-ref handling. Add an `"asking"` status label. Also finish placing `<LandmarkMap lat={story.lat} lng={story.lng} name={story.name} />` inside the story card, which is still missing.
- Errors from the gateway (including 402/429) surface in the existing `error` line rather than being swallowed.

## Verification

Build, then drive the flow in Playwright with simulated coordinates: type a description, confirm a matching place, map pin, and narration request; check `/api/transcribe` with a synthesized spoken clip.
