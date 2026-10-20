# Architecture

The full architecture is the "ארכיטקטורה טכנית" tab of the design doc. This file records the boundaries that the code must keep, so that they are checked in the repo and not only in a document.

## The one rule

Only `src/sim` changes hit points, resources, positions and combat results. Rendering, UI, audio and AI read snapshots or send commands. They never write simulation state.

## Dependency direction

```
content/ ──► src/sim ◄── commands ◄── src/client/input, src/ai, src/campaign, replays
                │
                └──► snapshots/events ──► src/client/render, src/client/ui, src/client/audio, src/persistence
```

- `src/sim` imports nothing from `pixi.js`, the DOM or audio. A headless run of 1,000 ticks must give the same hash every time.
- `src/ai` imports only the observation types from `src/sim/visibility` and the command types from `src/sim/commands`.
- `src/client/render` maps asset ids to sprites through `public/assets/manifest.json`; it never hard-codes sizes or file names.
- A match runs on a `SimContext` (`src/sim/context.ts`): the content catalog, the map and the navigation grid derived from them. The grid holds building footprints, so it is rebuilt from the map and the world when a save is loaded; it is never saved itself.

## Client (gate 2)

| Module | Job |
| --- | --- |
| `src/client/game.ts` | owns the world and the command queue; runs the fixed 20 Hz clock from real time (at most 5 ticks per frame, then drops time); keeps the previous positions for interpolation |
| `src/client/render/terrain.ts` | draws the map once into a canvas (ground, blood, membrane walls) → one texture |
| `src/client/render/worldView.ts` | sprites for every entity, interpolated between ticks; procedural breathing and hop; selection rings, team markers, move markers; navigation debug layer (F3) |
| `src/client/input/controls.ts` | camera (arrows, screen edge, middle drag, wheel zoom 0.6–1.6), selection (click, box, shift, double-click), right-click move, S/H, control groups |
| `src/client/ui/hud.ts` | Hebrew HUD in the DOM: resources, selection, dev buttons, performance line |

## Simulation clock

20 ticks per second (50 ms of game time). Positions in 1/256 of a tile, multipliers in thousandths, time in ticks. Two RNG streams: gameplay (seeded, saved) and cosmetic (never affects gameplay). Forbidden in gameplay code: `Date.now`, `Math.random`, `setTimeout`, animation callbacks.

## Rendering budget (reference machine: integrated Intel graphics)

| Item | Budget |
| --- | --- |
| Render resolution | up to 1920x1080; optional 0.75 render scale |
| Textures resident in a match | ≤ 96 MiB (two factions' units and buildings, neutral world, icons, the effects that faction pair uses, one map) |
| Atlas page | ≤ 2048x2048, power-of-two, WebP in transit |
| Live effect sprites | ≤ 300; additive effects ≤ 120 |
| Frame time | p95 ≤ 16.7 ms, p99 ≤ 33.3 ms in the reference fight (≈200 units, 60 buildings) |

Numbers are starting targets and get re-measured on the reference machine at gate 8.
