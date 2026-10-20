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

## Gate 3 · economy — done, waiting for Yakir's play test

Acceptance (`tests/sim/economy.test.ts`): a depot or crystal destroyed in the middle of work never breaks the game.
- a depot destroyed while loads are on the way: the carriers turn to the HQ and deliver there; with the HQ gone too they stop holding their loads, with the reason; nothing is credited without a dropoff; a new depot and a new order bring the held loads in first.
- a crystal destroyed under a harvesting carrier: the slot is released and the carrier moves to another crystal of the field.
- two carriers on a crystal of 15: one load of 10 and one of 5, never more; two harvests at an extractor ending on the same tick share the last 15 as 10 and 5.
- 20 carriers on two fields, and the Colony's 8 on theirs, for 3,000 ticks: ground + loads + bank + lost loads is the same every tick, and money changes only by delivered loads.
- a field running dry: carriers take what is left, then stop with the reason; a carrier killed with a load loses it; another order frees the slot and keeps the load; an unreachable crystal ends with `path_blocked`.

Measured on the arena: 8 carriers on 8 crystals bring 1.2 ATP/s each, first ATP after 7.5 s; income at 8 / 16 / 24 carriers is 10.2 / 15.7 / 15.7 ATP/s, so two per crystal is the full line. 60 carriers mining while 100 units cross: tick average 0.5 ms, p95 1.2 ms.

Also: determinism and save/resume hold in the middle of the cycle (slots held, loads on the way); the random-command monkey now gathers too.

In the browser: carriers start mining when the match starts (the Colony too); right-click a crystal with carriers to gather (the rest walk there); click a crystal or building to see what is left and who works it; the economy panel shows each field with carriers / useful maximum and warns 90 seconds before a field runs out; F3 shows who works what. Test lab: +8 carriers, a mitochondria by the far field, an amino pump on the protein deposit, destroy what is selected.

Not yet: construction and production (4), combat and vision (5), so no fleeing and no routing around enemies.

## Repository
- GitHub: `sirbolonez-hash/hostwars`, branch `main`. Claude pushes directly since 20.10.2026.

## Open
- Netlify site linked to the repository: the URL is still unknown here.
- Exact model of the reference machine's graphics (the gate 0 shell shows it once it runs on Yakir's computer).
