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

## Gate 4 · base and production — done

Acceptance (`tests/sim/production.test.ts`): every charge, refund and blocked-exit test passes.
- an order pays and reserves supply together; a refused one (money, supply, full queue, wrong building) changes nothing.
- cancel: waiting units back in full, a started one 75%, each once; a building destroyed at 99%: no ghost unit, waiting units refunded, the one in training lost.
- a walled-in exit: the unit waits finished, charged once, the next one does not start, and it appears once there is room.
- a capillary destroyed: units stay, training goes on, nothing new starts until under the cap again.
- building: one order at the lymph node, paid at the order; bad sites refused without a charge; two placements in one tick, one stands; growth from 10% to full over the build time, supply only when done; cancel 75%, destroyed nothing; repair paid over time; the outpost only where platelets stand; the amino pump only on the deposit, worked once grown; a building placed across a moving group: they walk around it, nobody inside.
- a monocyte turns into a macrophage; save/resume in the middle of training and growth.

Measured: a capillary grows in 399 ticks alone, 267 with one platelet squad, 228 with two, 229 with three.

In the browser: click the lymph node for its card (train carriers, order buildings with the reason on every button that cannot be pressed yet), place the ordered building on a green or red ghost, watch it grow; right-click with a production building selected sets its rally (the lymph node starts on the home field); platelets help or repair with a right-click.

## Gate 5 · combat and information — done

Acceptance (`tests/sim/combat.test.ts`): a full fight against a passive opponent, with no information leaking.
- the White Line's 34 (20 neutrophils, 6 macrophages, 8 eosinophils) march on the Colony's 20 defenders, beat them and destroy the core: victory at 59 s with 30 left; invariants hold every tick.
- out of sight: an order to attack a hidden unit reads like one at nothing; targeting ignores it; the memory of the Colony's core keeps the hit points it had when last seen, through damage and destruction; a remembered building is forgotten only when its empty site is seen; the placement preview does not react to a hidden unit, and the simulation's refusal says the same as for a visible one.

Also proven: windup and cooldown (a melee blow every cooldown exactly); moving away mid-windup gives no shot and leaves the cooldown as it was, and coming back means a full windup; bonus and armor; projectiles that fizzle and ones that land and splash; engulf and digestion; splash that spares its own side; histamine slows; an arc sweep of up to 3; two units killing each other on one tick; a kept target and the player's order winning; hold, move and leash; attack-move; victory, a draw, and refused orders after defeat; save/resume in the middle of a fight with projectiles in flight.

Measured (2-core Xeon): 200 units crossing and then fighting: tick average 1.8 ms, p95 5.6 ms. 60 carriers mining while 100 units cross: average 0.7 ms.

In the browser: fog with soft edges, enemy units hidden out of sight, remembered buildings in grey; right-click an enemy to attack, A then click to attack-move; impact bursts, projectiles, hit flashes, deaths; a victory, defeat or draw screen. Test lab: an attack army, Colony defenders, reveal the map.

Not yet: the Colony's AI and construction (gate 6), so the Colony only defends.

## Repository
- GitHub: `sirbolonez-hash/hostwars`, branch `main`. Claude pushes directly since 20.10.2026.

## Open
- Netlify site linked to the repository: the URL is still unknown here.
- Exact model of the reference machine's graphics (the gate 0 shell shows it once it runs on Yakir's computer).
