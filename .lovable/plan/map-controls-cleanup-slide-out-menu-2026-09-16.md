# Map controls cleanup + slide-out menu

## 1. Remove the zoom +/- buttons

The map currently adds a zoom control in the top-right corner, which sits under the
location/speed chip. Remove it. Pinch, double-tap and scroll zoom keep working, so
nothing is lost.

## 2. Add a menu button with a slide-out panel

A menu button (three lines) goes in the top bar, to the right of the location chip.
Tapping it slides a panel in from the left, over the map, with a dark backdrop;
tapping the backdrop, the close button, or pressing Escape closes it.

## 3. What goes in the menu

**Guide**
- Start / Stop guide (same action as the big round button)
- Travel mode: Driving or Walking (currently hard-coded to driving; this makes it a real choice that is passed to the story request)
- Recenter map on me

**Stories**
- Places along the way — the full list of everything told so far, tappable to re-read
  and re-center the map on that place
- Clear history

**Voice**
- Narration on / off (when off, stories are shown as text only)
- Repeat last story

**About**
- Short description of Wayfarer
- Safety reminder: keep your eyes on the road, the guide speaks so you don't have to look
- Map data credit (OpenStreetMap)

Anything on this list can be dropped or reordered — tell me which parts you want.

## Technical notes

- `src/components/LandmarkMap.tsx`: drop the `L.control.zoom(...)` line; add an
  imperative `recenter` capability (ref or callback prop) for the menu action.
- `src/routes/index.tsx`: add a `Menu` button in the header and render the panel with
  the existing shadcn `Sheet` component (side left). Lift `mode`, `narration` and the
  history list into the menu; `mode` is already accepted by both
  `getNearbyStory` and `describeNearby`, so it only needs to be passed through.
- Narration off means skipping the `speak(...)` call and leaving the status at
  `listening` instead of `speaking`.
- Panel sits above the map (z-index above the Leaflet panes) and below nothing else.
- Verify on mobile (360px) and desktop widths with a browser screenshot pass.
