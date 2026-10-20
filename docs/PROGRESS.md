# Progress

## Gate 0 · setup — accepted 19.10.2026

- 302 images mapped and processed; 326 assets including the code-built logo; 15 atlas pages; nothing missing.
- Review decisions applied: White Line set A, unit sizes kept, crown expressions "Virus Queen", English logo.
- Asset contract check, asset gallery, project skeleton.

## Gate 1 · simulation core — done, waiting to be built on

Acceptance: 1,000 ticks run twice give the same hash at every one of 20 checkpoints (`tests/sim/determinism.test.ts`).

Also proven by tests:
- save at tick 500 and resume gives the same final hash as never stopping;
- players' commands can arrive in any order within a tick;
- command validation and the queue's rules (`tests/sim/commands.test.ts`);
- integer maths, RNG and hash (`tests/sim/core.test.ts`);
- neutrophil lifespan and supply return (`tests/sim/lifespan.test.ts`);
- no forbidden API in `src/sim` (`tests/sim/purity.test.ts`);
- slice content validates, with art for every unit and building (`tests/content.test.ts`).

## Gate 2 · control and movement — done, waiting for Yakir's play test

Acceptance (`tests/sim/navigation.test.ts`):
- 80 units pass a 2-tile choke: all arrive, none stuck, none inside a wall, within 284 ticks (14.2 s) headless; in the browser 224 ticks (11 s).
- units go around obstacles without a repeated order: out of the U-shaped cup to a point behind it; around the HQ.
- a large body takes the 2-tile gap, a small one the 1-tile gap; an unreachable goal ends at the closest reachable point; a group spreads over separate spots; the current makes downstream 2x faster and upstream 2x slower (67 / 133 / 270 ticks over 40 tiles).

Also: determinism and save/resume still hold with navigation (shared paths and the path queue are saved).

Measured (headless, 2-core Xeon 2.1 GHz, 200 units crossing the arena toward each other, 900 ticks): tick average 0.9 ms, p95 1.6–4.3 ms across runs, p99 6.6–9 ms; first ticks after a 200-unit order are the heaviest. Faster A* and group path sharing halved the search work of that run (260k → 128k node expansions) and cut the cost per expansion to a third.

Play test (Yakir, on the reference machine): open the Netlify build, press F3, send groups around; the line at the bottom left shows fps and tick time.

Known limits:
- two big crowds sent through each other in a narrow pass can still jam; combat (gate 5) will usually settle this before it happens.
- unit art is wider than unit bodies, so tight crowds overlap visually.

Not yet: economy (gate 3), construction and production (4), combat and vision (5).

## Repository
- GitHub: `sirbolonez-hash/hostwars`, branch `main`. Claude pushes directly since 20.10.2026.

## Open
- Netlify site linked to the repository: the URL is still unknown here.
- Exact model of the reference machine's graphics (the gate 0 shell shows it once it runs on Yakir's computer).
