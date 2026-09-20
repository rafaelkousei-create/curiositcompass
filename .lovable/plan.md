# Simpler, calmer Wayfarer

A simplification pass on the main screen: less chrome, fewer buttons, one accent color.
No behavior changes — GPS, stories, narration, ask/describe and the menu keep working exactly as they do now.

## 1. Compact top bar

Merge the three separate pieces (menu button, Wayfarer card, location chip) into one low, compact row:

- A single small pill that holds "Wayfarer" plus the live status ("Guide is off / listening / speaking / finding places") — replaces the tall two-line card.
- The location/speed chip becomes a small compact element in the same row (or merges into the pill on narrow screens).
- Menu button stays on the left, same height as the pill.
- Net effect: the top bar is roughly half as tall, so more map is visible.

## 2. Simpler bottom panel (priority — it feels crowded)

The control row becomes: one big round Start/Stop button + two small icon buttons + one compact "Ask" button.

- "Tell me now" and "Next place" become small circular icon buttons (megaphone and skip icons) beside the round Start button — no text labels, so nothing is truncated.
- "Ask about a place" becomes a single compact pill below the button row; the voice/text ask panel opens as it does now.
- Buttons stop fighting for width; the row reads at a glance.

## 3. Story-first panel

- The intro text ("Every place has a story. Start the guide or describe something you can see.") shows only before the first story.
- Once a story arrives, the story card takes over the panel and the panel shrinks to fit its content instead of keeping a fixed tall height — less empty space and less crowding.

## 4. Calmer look

- One accent color: the warm amber stays the single accent; the secondary cyan disappears from UI chrome (the current-location map dot keeps its color so it stays visible on the map).
- Softer surfaces: gentler borders and shadows on the top pill and bottom panel, slightly stronger blur, so the panels sit quietly over the map instead of shouting.
- The pulse ring stays only on the Start button while the guide is running.

## Technical notes

- All changes live in `src/routes/index.tsx` and `src/styles.css` (token/surface tweaks, icon button styles).
- Story card, history, menu contents, narration toggle and recenter stay untouched.
- No new dependencies; icons already in use via lucide.

## Verification

- `bunx tsgo --noEmit` clean.
- Playwright screenshots at 360px and 1280px: compact top bar, icon button row, story replacing intro, no truncated labels, no console errors.
