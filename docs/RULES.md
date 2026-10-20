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

## Economy (gate 3)

### Resources on the map
- A glucose crystal has a stock (small 600, large 1,800) and one work slot. Each base has a field of 8 (4 small, 4 large: 9,600) in a crescent behind its HQ; a field is a numbered group of crystals with a name for the interface.
- Protein and iron sit in deposits (1,800) worked only through an extractor on top (amino pump, siderophore tower), which has 3 work slots. A deposit links to at most one extractor and the link is mutual.
- Resources block movement like buildings. An emptied crystal or deposit leaves the map at the end of its tick (`died`, cause `depleted`). An extractor whose deposit is gone stays, with nothing to work.

### The cycle (one carrier)
1. **To the target**: walk to one of the 3 open tiles next to it that are closest to the nearest dropoff (carriers of one target spread over them).
2. **At the target**: within reach (body radius + 96 sub-tiles of the footprint), take a free work slot and harvest (5 s). If the slot is taken: a free crystal of the same field within 5 tiles that nobody is heading for, or wait in line (looking again every second).
3. **Harvest ends**: take min(load left, stock) in one action and release the slot. Two carriers that finish on the same tick take in entity-id order, so nobody takes past the stock.
4. **To the dropoff**: the nearest own dropoff (HQ, mitochondria, biofilm core, fermentation pit); walk to its nearest open side.
5. **Unload** (1 s): the load becomes ATP (glucose) or the advanced resource (protein, iron) in one action, with a `delivered` event. Then back to the same target.

Measured on the arena (5 s harvest, 1 s unload, crystals 4 tiles from the HQ): one carrier per crystal brings 1.2–1.3 ATP/s, two per crystal 1.0 ATP/s each (the design's opening value), a third adds nothing. Saturation is shown as carriers / (2 × crystals).

### The order
- `GATHER {units, target}`: target is a crystal, a deposit with the player's extractor on it (the order goes to the extractor), the player's extractor, or the player's dropoff (return cargo).
- Carriers in the list are spread over the field: each takes the crystal with the fewest carriers, ties to the one nearest the clicked crystal. Units that cannot carry are left alone (the client sends them a MOVE).
- A carrier holding a load delivers it first, then starts on the new target. GATHER on a dropoff: carriers with a load deliver it and go back to what they were mining (or stand idle if they were not mining); carriers without a load are unaffected.
- MOVE, STOP and HOLD end gathering at once and release the slot; the carrier keeps its load.
- Rejected: `unknown_target` (missing or dead), `not_owner` (enemy building or extractor), `no_extractor` (a deposit with none, or with the enemy's), `bad_target` (anything else), `depleted`, `no_carriers` (no carrier in the list).

### Failure at every step
- **Crystal depleted or destroyed** (on the way, waiting, or mid-harvest): the slot is released; a carrier with a load goes to unload; otherwise it takes the least worked crystal of the same field, then any crystal within 12 tiles. None left: it stops (`gather_stopped`, `depleted`).
- **Extractor or its deposit gone**: carriers there stop (`no_extractor` / `depleted`); loads already taken are delivered.
- **Dropoff destroyed on the way or during unload**: the carrier turns to the nearest other dropoff. None left: it stops holding its load (`no_dropoff`); the load is not money until a later GATHER brings it to a dropoff.
- **Path blocked**: travel that ends short counts as a failed approach. After 3 the carrier tries another target (another crystal of the field, another dropoff); after 6 in a row it stops (`path_blocked`). A walled-in target fails at once.
- **Carrier dies**: its slot is released in the death phase and its load is lost (the `died` event carries it).

### Rules that must hold (checked after every tick in tests)
- Stocks, loads and player resources are never negative; a load never exceeds the carrier's capacity; a load has a kind exactly when it is above zero.
- Money changes only by `delivered` amounts. Ground + loads + banked + lost with dead carriers is constant.
- Every taken slot belongs to a living carrier harvesting exactly that target; a harvesting carrier holds exactly one slot of its target.
- A gather state exists exactly when the order is `gather`; only carriers gather.

### Movement while gathering
- Carriers on a gather order pass through other bodies (no separation pushes either way), so a mining line never jams; walls and buildings still push them out.
- Gathering travel does not raise `arrived` / `blocked` events; the gather cycle handles its own outcomes.

### Not yet
- Fleeing from danger, and keeping carriers from routing through enemy lines, come with combat and vision (gate 5).
- Building dropoffs and extractors, rally points to a field, and new carriers from the HQ come with construction and production (gate 4).

### Dev matches
- `DEV_SPAWN` with a building id places one finished building with its centre on the tile under the point, if the footprint is open ground with no unit on it or next to it (`site_blocked` otherwise). An extractor goes on the free deposit of its kind under the point and links to it.
- `DEV_KILL {targets}` sets the listed entities' hit points to 0; they die in the death phase of that tick (resources and buildings too).

## Base and production (gate 4)

### Money and supply
- An order pays in full and reserves its supply in the same action, or is refused and changes nothing (`no_resources`, `supply_capped`, `queue_full`, `requirements`, `cannot_produce`, `not_ready`).
- Supply used = the supply of living units. Supply reserved = the supply of every queued unit plus the extra of every morph in progress. An order needs used + reserved + its own ≤ cap.
- The cap counts finished buildings only (a growing capillary gives nothing yet), never above the faction's 120.
- Going over the cap happens only when a supply building is lost: units stay, a unit already in training finishes, and no waiting unit starts until used + training ≤ cap again.

### Production queues
- Each production building has a queue of up to 5. Only the front unit trains; it starts on the tick it reaches the front (the tick it was ordered, for an empty queue) and is done after the unit's training time.
- A finished unit appears on the free spot nearest the building's exit (the tile below the middle of its footprint), searching up to 3 tiles through open ground from the building, so never on the far side of a wall. With no spot it stays finished in the queue (`exit_blocked`, reported once), charged once, and the next unit does not start; it appears the first tick there is room.
- Cancel: a unit not yet started is refunded in full, a started (or finished and waiting) one 75%. Each item is refunded at most once.
- A production building destroyed: units not yet started are refunded in full; the one in training is lost; nothing appears. Reserved supply returns.
- Rally: a point (new units walk there), a unit (they walk to where it is), or a crystal or an extractor (new carriers start mining; other units walk there). The match starts with the lymph node's rally on the home field.

### Building
- The White Line orders a building at the lymph node, which holds one order at a time; the order pays in full (`QUEUE_BUILD`). Placing it costs nothing more (`PLACE_BUILD`), and frees the slot for the next order. Placed buildings grow at the same time as each other.
- A site is refused (the order stays, nothing is charged) when: it leaves the map; any tile is a wall, blood or taken by a building or resource (`bad_ground`, `site_blocked`); an enemy unit stands on it (`site_blocked`, the same words whether or not the player can see it); it would cover any production building's exit, or its own exit is not open ground (`blocks_exit`); or the placement rule fails:
  - most buildings: within 8 tiles (edge to edge) of one of the player's buildings (`too_far`);
  - the lymph outpost: where a platelet squad of the player stands, within 2 tiles (`no_builder`);
  - an extractor: exactly on a free deposit of its kind (`no_deposit`), and it links to it.
- Friendly units standing on the site step to the nearest open spot when the building appears; every unit whose path now runs into it searches again at once.
- Two placements in one tick: the first stands; the second finds no order (or a taken site) and pays nothing.
- Growth: the building stands from the first tick with 10% of its hit points and gains the rest evenly over its build time; it is a target from the first tick. Damage taken while growing stays taken.
- A growing building does nothing yet: no supply, no production, no dropoff, no work slots.
- Cancel an unplaced order: full refund. Cancel a growing building: 75% back, the building goes. A growing building destroyed: nothing back.

### Platelets
- `ASSIST_BUILD`: platelet squads walk to a growing building of theirs and help: the first squad adds 50% growth speed, the second 25%, more add nothing. They stop when it is done.
- `REPAIR`: on a finished, damaged building. Every half second a squad restores 1/(build time in half-seconds) of the building's hit points (at least 30 s' worth for buildings with no build time), paying in proportion so that a full repair costs a quarter of the building's price. Without the money it waits; it stops when the building is whole.
- Any other order ends the job.

### Morph
- `DEPLOY`: a monocyte turns into a macrophage once the spleen stands. It pays the macrophage's price and reserves the extra supply at the order, stands still for the training time and takes no orders, then changes type keeping its share of hit points.

## Combat (gate 5)

### An attack, in four stages
1. **Target.** An idle unit looks for an enemy it can see within its sight (every 4 ticks, staggered); a holding unit or a defense building only within weapon range. Preference: units that can fight, then other units, then armed buildings, then other buildings; then the nearest; then the lowest id. A target is kept while it is alive, seen, and within the range plus 2 tiles (a holding unit: within weapon range) — no hopping from tick to tick.
2. **Windup.** In range (body edge to body edge, within minimum range; a ranged weapon also needs no membrane in between), the unit stops and winds up for the weapon's windup. Out of range it chases (an idle unit at most 8 tiles from where its fight began, then it walks back without fighting).
3. **Launch.** At the end of the windup. The cooldown runs from the launch: the next windup starts so that the next launch comes exactly one cooldown later.
4. **Landing.** Melee, arc and instant splash weapons land on the launch tick; projectiles after their flight (distance ÷ speed, at least one tick). Everything landing on a tick lands in launch order, before deaths are settled, so two units can kill each other on the same tick.

- Moving away (a new order, or the target leaving range) during a windup cancels that attack: no shot, and the cooldown is left as it was. Coming back means a full windup again — no free shot.
- `MOVE` only moves; units on gather, build or morph orders never fight. `HOLD` fights from where it stands. `ATTACK` follows one target until it dies or is lost from sight, then the unit goes idle. `ATTACK_MOVE` walks to the point (the same arrival spots as a move), fights whatever it meets on the way with no leash, and goes on when it is clear.
- `ATTACK` on something the player cannot see is refused with the same reason as on something that does not exist (`unknown_target`).

### Damage
- Damage = max(1, damage × the weapon's best bonus for the target's tags ÷ 1000 − the target's armor). Buildings carry the tags `building` and `structure`.
- Splash hits every unit and building of the other side within the splash radius of where it lands (body edge); never one's own side.
- An arc sweep hits its target and up to `maxTargets − 1` more of the other side within range, inside the arc in front of the attacker.
- Engulf: a unit at or below the threshold without a capsule dies at once; the macrophage then digests for 3 cooldowns. Otherwise it is an ordinary blow.
- A projectile whose target dies first: `fizzle` weapons are gone; `ground` weapons land at the last point and splash there.
- Slow (histamine): speed −40% for 1.5 s; a new slow replaces the old one, they do not add up.

### The end of a match
- A player with no critical building left (lymph node, bone marrow, spleen, germinal centre, thymus academy; biofilm core and the Colony's production buildings) is defeated on that tick; their orders are refused from then on. A player who surrenders is defeated on that tick too.
- When one team is left, it wins; when the last teams fall on the same tick, it is a draw.

## Vision and fog (gate 5)
- Per player, each tile is unexplored, explored-hidden or visible. Sight is a circle (whole tiles) around each living unit and building; membranes do not block it in the slice. Allies share sight.
- Vision is worked out at the start of each tick (for orders) and again after movement (for targeting); it is never saved, it is recomputed from the world. Explored tiles are world state.
- A building or resource of someone else that the player has seen is remembered as it was last seen (type, place, hit points, growth, stock). It does not change while out of sight; it is forgotten when its tile is seen again and it is gone.
- Nothing hidden reaches the player: units out of sight are not drawn and cannot be picked; remembered buildings are drawn grey as last seen; hit point bars, effects, deaths, projectiles and the debug layer show only what is seen; an inspected enemy building is dropped when it leaves sight; the placement preview ignores what is not seen, and the simulation's refusal uses the same words either way; orders on unseen targets read as orders on nothing.

## The Colony (gate 6)

### Biofilm
- Every finished biofilm core spreads biofilm around itself: 3 tiles when it is finished, one tile more every 4 seconds, up to 10. A starting core has spread in full from the first tick. Walls carry none. Where two players' biofilm meets, the older core holds the tile.
- Biofilm is derived from the cores standing in the world at the start of every tick; it is never saved, so a loaded match has exactly the same ground. A dead core's biofilm is gone on the next tick.
- What it does: the Colony builds (except cores and extractors) only on its own biofilm. Whatever stands on its own biofilm takes 25% less damage, and its units regain 1 hit point a second there. Antibodies (the plasma cell's volley) lose 60% against anything standing on biofilm. White Line units walk 20% slower on someone else's biofilm.

### A feeder becomes the building (`BUILD_AT`)
- The first feeder in the order (by id) walks to the site and becomes the building, growing from 10% like any other. The price is paid at the order; the feeder's supply is freed when it becomes the building.
- The site is checked at the order and again on arrival. If it is lost on the way (taken, no longer on biofilm), the feeder stops, the money comes back in full and the player is told why. A feeder that dies on the way, or is given another order, also brings the money back.
- A new core may go anywhere (it makes its own biofilm); an extractor goes on a free deposit of its kind.

### Splitting (`SPLIT`)
- A Colony fighter standing on its own biofilm, with no attack made or taken for 3 seconds, can split: the full price of the unit is paid and its supply reserved at the order; it stands still for half its training time, then a second unit appears beside it.

## Antigen presentation and tier 2 (gate 6)
- A dendritic cell samples an enemy it can see (`SAMPLE`; a right-click on an enemy): it stays within half a tile of it for 5 seconds (sampling starts over if it is pushed away), then carries the sample to the nearest standing lymph node. There it is processed for 30 seconds, one sample at a time per lymph node, and the enemy's family opens for the player. A dendritic cell killed on the way loses its sample; a lymph node lost while processing loses what it held.
- Every enemy unit and building has a family (staph, bacillus, enteric, spiro, pneumo, strep, clostridium). Tier 2 (the thymus academy and the germinal centre, the plasma cell) needs any family opened.
- Acquired cells (CD4, CD8, Treg, plasma) are trained against the family opened last: +50% damage against that family, −30% against every other.
- CD4 helpers: acquired cells within 6 tiles of a CD4 attack 1/6 faster (IL-2); macrophages within 6 tiles hit 50% harder and can swallow capsules (IFN-γ). A helper does not help itself.
- Damage, in order: the weapon's bonus for the target's tags; the attacker's boost; specificity; biofilm under the target; armor; never below 1.

## The AI (gate 6)
- The AI plays with the player's commands, prices and fog. It sees an observation built for its player (own things in full; enemies only while seen; enemy buildings as remembered) and asks the match only whether a building could stand somewhere, through the same check as the placement preview (limited to what it sees). Its commands run 2 ticks after its thought.
- Layers: economy (workers, supply, the build plan, expansion, units; every 8–24 ticks by difficulty), army (defence, the wave, raids, scouting, splitting, sampling; every 4–12 ticks), strategy (when to attack, when to give up; every 2–5 seconds). One ledger of money and supply is shared by every layer, including what its commands still on their way will spend.
- Personalities: the White Line fortifies (a mast cell by its mining line), sends a dendritic cell early and moves to tier 2; the Colony raids carriers with flagellates, spreads biofilm and splits fighters waiting on it.
- Difficulties: easy (a small army, a first wave by 8 minutes whatever it has, slow to answer, never retreats), normal (scouts, expands, answers what it saw, attacks with an advantage), hard (faster thoughts, a second production building, two towers, raids and waves at once). The same resources and fog on every level.
- Recovery: lost workers are trained again first; a Colony without a core builds a new one; a site that keeps being blocked is given up after three tries. With no workers it can use, no army and no way to make either, it surrenders (`SURRENDER`, with its reason), which defeats it at once.
- Its whole state is plain data saved with the match; the same observations always give the same commands.

## The host (gate 7)

### The monitor (missions)
- Inflammation, 0–100: a neutrophil dying +2, a NET +3 more, every histamine pulse +0.4, a toxin glob +1, a toxin tower's shot +0.3. It ebbs 0.3 a second always, 0.5 a second more once nothing has been hit anywhere for 10 seconds, and 0.2 a second more for every regulatory T cell.
- Tiers: 0–30 calm; 31–60 active (extra exit gates open, reinforcements come a quarter sooner); 61–85 raging (the tissue loses 1% a minute, twice that with a fever above 40; the pressure falls a quarter of a point a second); 86–100 a cytokine storm (60 seconds to bring it under 86, or the mission is lost).
- Fever = 37 + inflammation × 4 ÷ 100 (37–41 °C). At 38–39 immune cells move 10% faster and bacteria take a fifth longer to split.
- Pressure starts at 85 and recovers half a point a second while inflammation is under 61. Under 65 production slows by a quarter (no progress one tick in four); under 50 for 60 seconds is shock, and the mission is lost.
- Tissue integrity: the host cells' hit points now against when the mission began. Each mission has a minimum; below it the mission is lost.

### Host cells, pus and NETs
- Host cells are neutral, 1×1, and in the way. Area damage of either side hurts them. In a mission, bacteria with nothing else to fight feed on them.
- Where a neutrophil dies, the 3×3 tiles around it fill with pus for two minutes: everyone on pus walks 30% slower. A macrophage (or Big Mac) standing on pus cleans a tile a second and heals 6 hit points as it does.
- NET (N): each selected neutrophil bursts. Every enemy within 3 tiles is held for 6 seconds (no moving, no attacking; bodies may still nudge it) and takes 40 damage. The neutrophil is gone, and leaves pus.

### Heroes
- Big Mac: a heavy macrophage (650 hit points, armor 3, engulfs up to 200). Big meal: swallows an enemy unit of up to 400 hit points within a tile and a half; 30 s. Clean: clears the pus within 4 tiles and heals his side's units there by 40; 20 s.
- Dr. Dendra: a dendritic cell that samples in one second. Scan: shows everything within 16 tiles of her for 8 seconds; 25 s.
- A mission with a hero is lost if the hero falls.

### Zones
- On maps that mark them, the germinal centre stands only in a follicle (B zone) and the thymus academy only in the paracortex (T zone). Maps without zones (the arena) do not restrict them.

## Missions (gate 7)
- A mission is content: its map, who starts with what, host cells, exit gates, objectives, and triggers. A trigger waits for all its conditions (time, an objective's state, units in an area, tagged things gone or standing, counts, units trained, an antigen opened, inflammation above or below, no army), optionally held for a while, and then acts (spawn units, at a point or at the next open exit gate, optionally on an attack-move; set an objective; a line of dialogue; win; lose; switch a trigger off; grant resources; change inflammation). A repeating trigger fires again after its interval while its conditions hold; a reinforcement comes a quarter sooner while inflammation is active.
- The mission decides the end. The usual defeat (no critical building) does not apply. A mission is also lost to a cytokine storm, shock, tissue below its minimum, or a fallen hero.
- Mission 1, the scratch: no base. Reach the wound with neutrophils, destroy three staph clusters, bring platelets to the wound floor for 10 seconds. The wound sends bacteria into the tissue until it is sealed. Tissue minimum 60%.
- Mission 2, inflammation: build a capillary junction and a bone marrow branch, stop the red front before the lymph vessel in the north-east (three enemy units there for 4 seconds lose the mission), destroy both biofilm cores. Big Mac. The Colony has an easy AI and sends a front every 80 seconds. Tissue minimum 50%.
- Mission 3, the node: hold the lymph node for 20 minutes against waves coming down four lymph vessels, bring an antigen sample, train a first CD4 and a first B (plasma) cell. Dr. Dendra. Lost if the node falls, or at 26 minutes.
