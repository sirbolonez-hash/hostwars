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
- A match runs on a `SimContext` (`src/sim/context.ts`): the content catalog, the map and the navigation grid derived from them. The grid holds building and resource footprints, so it is rebuilt from the map and the world when a save is loaded; it is never saved itself.

## Simulation modules

| Module | Job |
| --- | --- |
| `src/sim/sim.ts` | the tick in its 12 phases; applies commands; the death phase; hash and invariants |
| `src/sim/core/world.ts` | the world as plain data: players, entities (units, buildings, resources), path queue; spawn and remove; snapshot |
| `src/sim/commands/commands.ts` | command types, shape check, validation, the queue |
| `src/sim/navigation/*` | grid, A*, line checks, arrival spots, movement (phase 5). `travelTo` lets another order travel as one of its steps |
| `src/sim/economy/gather.ts` | phase 7: the carrier cycle (to target, harvest, to dropoff, unload), work slots, the GATHER order and its validation |

An entity carries all its state in plain fields: `order` and `mv` (movement), `res` (stock, field, work slots and the deposit ↔ extractor link on resources and extractors), `gather` (the carrier's stage, target, dropoff, timer and failed approaches) and `cargo` / `cargoKind`. Reservations live in one place, the slot array of the target, so releasing one is a single scan and a save holds them exactly.

## Client (gates 2–3)

| Module | Job |
| --- | --- |
| `src/client/game.ts` | owns the world and the command queue; runs the fixed 20 Hz clock from real time (at most 5 ticks per frame, then drops time); keeps the previous positions for interpolation and the events of every tick in the frame |
| `src/client/render/terrain.ts` | draws the map once into a canvas (ground, blood, membrane walls) → one texture |
| `src/client/render/worldView.ts` | sprites for every entity, interpolated between ticks; procedural breathing and hop; crystals that shrink as they are worked; loads in carriers' hands, the harvest sparkle, "+10" and ATP orbs on delivery, saturation over each field; selection rings, team markers, move markers; navigation and gathering debug layer (F3) |
| `src/client/input/controls.ts` | camera (arrows, screen edge, middle drag, wheel zoom 0.6–1.6), selection (click, box, shift, double-click), inspecting a building or resource, right-click move or gather (carriers gather, the rest walk), S/H, control groups |
| `src/client/ui/hud.ts` | Hebrew HUD in the DOM: resources with icons and income per minute, the economy panel (fields, saturation, the warning 90 s before a field runs out, idle carriers), why carriers stopped, selection and inspection, test lab, performance line |

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
