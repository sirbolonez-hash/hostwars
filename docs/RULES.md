# Rules

Every gameplay rule and edge case gets written here before it is coded, and every rule here has a test. Sections fill in gate by gate.

## Assets (gate 0)

- An asset is referenced by id only. A missing asset renders as a coloured box with its id; it never crashes the game.
- Display size comes from the manifest. Gameplay size (body radius, footprint) is independent of the picture, so a redrawn image never changes the game.
- Units face lower-left; facing right is a horizontal flip. Walking, breathing, attack lunge and hit flash are procedural.
- A building blocks exactly its footprint rectangle. Art that hangs over the footprint does not block.
- Additive (`add`) effects are light: they brighten the ground. Keyed (`key`) effects are objects and draw normally.

## Simulation core (gate 1)

- One tick is 50 ms of game time. The tick runs in the 12 phases of the architecture (tab 2, section 3); phases that later gates fill are named in `src/sim/sim.ts` so the order never shifts.
- Commands are the only way to change the world. Each carries `player`, `seq`, `tick` and the command.
- Execution order within a tick: by tick, then player id, then seq. Arrival order between players does not matter.
- A player's `seq` must strictly increase; a repeat or a step back is rejected (`duplicate_seq`) at submission.
- A command for a tick that already ran is rejected (`late`). Malformed input (wrong type, fractional numbers) is rejected (`bad_shape`).
- Validation at execution: the player exists and is not defeated; 1–200 unique unit ids; each id is the player's own unit (`not_owner`, `not_a_unit`); an id that never existed is `unknown_unit`; a unit that died earlier is skipped quietly; a MOVE target lies inside the map.
- A rejected command changes nothing.
- MOVE (until navigation arrives in gate 2): straight line at the unit's speed; on reaching the point the unit goes idle and an `arrived` event fires. STOP goes idle; HOLD holds.
- Lifespan: a unit with `lifespan > 0` dies on the tick when `tick − bornTick` reaches it (neutrophil: 3,600 ticks = 180 s), and its supply returns that tick.
- Supply used always equals the sum of the owner's living units; supply cap is the sum of the owner's buildings, never above the faction cap (120).
- A save holds the world and the command queue (pending commands and last seq per player). Resuming a save gives the same hashes as never stopping.
