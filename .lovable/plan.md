# Map-first front page

Rebuild the main Wayfarer screen as a full-screen map experience, keeping the existing guide, skip, ask, narration, and history behavior.

## What will change

- Make the map fill the screen and follow the user’s current GPS position.
- Show a distinct second marker for the landmark currently being described.
- Add a compact top bar for the Wayfarer name, driving status, and location state.
- Place the existing Start/Stop, “Tell me something now”, Skip, and Ask controls in a fixed lower panel occupying roughly one third of the screen.
- Present the current landmark story in the lower panel without obscuring map context; allow the content area to scroll when needed.
- Keep typed and spoken descriptions, spoken narration, errors, and previous landmarks working as they do now.
- Adapt the layout for phones and wider screens while preserving the map-first structure.

## Technical details

- Replace the separate story map with a single page-level OpenStreetMap view.
- Update the map component to display current-position and landmark markers together and reframe around both when available.
- Reorganize the existing home-screen markup and styling; no changes to landmark search, transcription, or narration services.
- Preserve accessible labels and controls, and keep the existing page metadata.

## Verification

- Check the screen with simulated GPS on desktop and mobile sizes.
- Confirm current location appears, a described landmark adds its marker, and all existing controls remain usable.
- Confirm the project builds without errors.
