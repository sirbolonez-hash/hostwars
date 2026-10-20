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

## Navigation and movement (gate 2)

### The grid
- A map is ASCII rows (`content/maps/*.json`): `.` open tissue, `#` wall, `~` blood (open, may carry a current). Tile = 256 sub-tiles = 32 screen pixels.
- Building footprints are stamped onto the grid when a building appears and lifted when it goes. The grid is not saved: a loaded match rebuilds it from the map and the buildings in the save.
- Body sizes: small and medium bodies need one free tile; large bodies need a free 2x2 square and path on its top-left tile. A 1-tile gap lets small and medium through, not large.

### Orders
- A unit sent alone goes exactly to the clicked point if it can stand there, otherwise to the nearest tile it can.
- A group gets one arrival spot per unit, spread breadth-first from the clicked tile: large bodies take 2x2 blocks first, then the rest take single tiles. Units nearer the target get spots nearer the target.
- If a spot cannot be reached, the unit goes to the reachable tile closest to it, and that becomes its goal (it stops there; no endless trying).

### Paths
- A* over 8 directions, no corner cutting, integer costs (10 straight, 14 diagonal), ties broken by f, then h, then tile index.
- The current changes the cost of entering a tile: factor = 1000 + strength × cos(angle to the current), between 500 and 2000 (‰ of base speed). Travel uses the same factor, so downstream is up to twice as fast, upstream half.
- Path smoothing keeps only turning points, checking each straight leg with the unit's body width (it never grazes a corner it cannot pass).
- Group sharing: the first member of a group order to search publishes its path for its body size. A member that starts within 8 tiles of that path's start follows it, keeping its own offset while the ground allows and drawing in at narrows, and leaves it where its own spot is in sight. Up to 16 published paths per group; they expire after 200 ticks. They are saved with the world.
- Searches run from a queue under a budget of 8,000 node expansions per tick (one search may finish past it). Player orders go first; a repath waits behind them for at most 20 ticks. Attaching to a shared path is charged a fixed 24.

### Movement, each tick
1. Follow: move toward the next waypoint at speed × current factor. An intermediate waypoint counts as passed within one body radius, or within 1.5 tiles if the following one is already in clear reach.
2. Separation: every overlapping pair is pushed apart along the line between them; a unit on the move takes a quarter of the push against one standing still. Two travelling units heading more than 135° apart also step to their own right, so they slide past each other. All pushes are summed, then applied (order does not matter), capped at half a radius per tick.
3. Walls and buildings push a body out of any blocked tile it overlaps. If its centre still ends inside one, it goes back to where it started the tick.
4. Progress: a travelling unit must get a quarter tile closer to its goal every 3 seconds. After a window without progress: if it is within a tile plus two radii of its goal it counts as arrived (crowded spot); after 2, 5 and 8 such windows it repaths; after 10 it gives up (`blocked` event).

### Dev matches
- `DEV_SPAWN` (test matches only) puts up to 100 units of one type around a point, each on the nearest tile it can stand on, ignoring cost and supply.
