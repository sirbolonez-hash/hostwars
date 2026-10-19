# HOST WARS

A real-time strategy game inside the human body: three factions (the White Line, the Colony and the Crown) fight for a host's life across a 20-mission campaign. Family-friendly, Hebrew first, runs in the browser.

The game design and the technical architecture live in the shared design doc (two tabs: the GDD and "ארכיטקטורה טכנית"). This repo holds the code, the content files and the asset pipeline.

## Run

```bash
npm install
npm run dev          # game shell at http://localhost:5173, asset gallery at /gallery.html
npm run check        # type check + asset contract + tests
npm run build        # static build into dist/ (what Netlify serves)
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/sim` | the authoritative simulation: fixed tick, integers only, changed only through commands |
| `src/ai` | opponent AI; sees only the observation, sends ordinary commands |
| `src/client` | PixiJS rendering, the Hebrew HTML interface, input, audio |
| `src/campaign`, `src/persistence` | missions and triggers; save, replay, bug bundles |
| `content/` | game data as JSON (units, buildings, weapons, tech, maps, missions) |
| `public/assets/` | processed art and `manifest.json` (generated; do not edit by hand) |
| `tools/assets/` | the Python asset pipeline that turns the raw images into `public/assets` |
| `docs/` | rules, content schema, progress and decisions |

## Current gate

Gate 0 (setup). See `docs/PROGRESS.md`.
