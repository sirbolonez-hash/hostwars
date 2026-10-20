# Decisions

Each entry: the problem, the options, the choice, what it costs, and what would make us revisit it.

## 2026-10-19 · Asset pipeline in Python, outside the game build
- Problem: 302 large PNGs need keying, trimming, frame cutting and atlas packing.
- Options: a Node pipeline (sharp), a Python pipeline (Pillow, NumPy, SciPy), a hosted tool.
- Choice: Python. The image maths (flood fills, connected components, seam blending) is shorter and easier to check.
- Cost: running the pipeline needs Python 3 with Pillow, NumPy and SciPy. The game build does not.
- Revisit if: the pipeline must run on Netlify during the build.

## 2026-10-19 · Display sizes and 2x textures
- Choice: tile 32 px; units 36–120 px (small 46, medium 62, large 88, huge 120, heroes 96); buildings 1.35 × footprint width. Textures stored at 2x so zooming to 150% stays sharp.
- Cost: 2x textures use four times the memory of 1x. A full match stays under the 96 MiB budget.
- Revisit if: Yakir's review of the unit field says units are too big or too small (one number per class in `tools/assets/sizes.py`).

## 2026-10-19 · Maps are the painted image at 2x, 104 × 58 tiles
- Problem: the map paintings are 1672 × 941. The architecture assumed 112 × 63 tiles.
- Choice: upscale exactly 2x (Lanczos + light sharpening) to 3344 × 1882, which is 104 × 58 tiles. No non-integer scaling.
- Cost: maps are 7% smaller than planned.
- Revisit if: a mission needs more room; then a map gets painted at a higher resolution.

## 2026-10-19 · Keying black effect backgrounds
- Problem: effects were drawn on black. A plain threshold left dark halos on light ground.
- Options tested side by side over light and dark ground: threshold at 40, flood fill below 100 with a soft edge, plain unmultiply, boosted unmultiply.
- Choice: glows use unmultiply (exact under additive blending); solid effects use the flood fill below 100 with a soft edge, which removes halos and keeps outlines and pupils.
- Revisit if: an effect shows a dark fringe on bone or plastic ground in the gallery.

## 2026-10-19 · Library versions
- Choice: pixi.js 8.22.0, vite 7.3.7, typescript 5.9.3, vitest 4.1.12, pinned exactly. `.npmrc` sets `legacy-peer-deps` because npm 10 crashes resolving Vite's optional devtools peers.
- Revisit if: a security fix or a needed feature lands in a newer version.

## 2026-10-19 · Review decisions (Yakir)
- White Line buildings: set A (pink and moss, with its drawn damaged states). Set B stays in the repo as `_alt`.
- Unit sizes stay as they are.
- Crown expressions: the "Virus Queen" sheet (Claude's pick: the crown is fully in frame and the calm face matches the portrait). The other sheet is `expr_crown_alt`.
- Logo: English, built in code (below).

## 2026-10-19 · Logo built from font outlines
- Choice: Luckiest Guy (Apache-2.0, `@fontsource/luckiest-guy`) converted to SVG paths by `tools/assets/logo/make_logo.py`; the O is a drawn White Line cell, a Colony bacterium peeks from behind the H, a Crown gem virus wears a crown on the S. Rasterized with resvg.
- Cost: changing the wording means rerunning the script, not editing text.
- Revisit if: a Hebrew title is wanted; the same script can take a Hebrew font.

## 2026-10-19 · Commands keep per-player order; saves include the queue
- Problem: the save/resume test diverged because commands scheduled for later ticks lived only in the queue.
- Choice: a save is the world plus the command queue. Each player's `seq` strictly increases at submission, as a network stream would guarantee; players may interleave in any order.
- Revisit if: a transport ever reorders one player's commands; then the queue sorts on arrival instead of rejecting.

## 2026-10-19 · No lymph outpost in the slice content yet
- Problem: the architecture's expansion building (שלוחת לימפה) has no art.
- Choice: left out of `content/` until gate 4. Proposal: reuse the lymph node art at about 75% size.

## 2026-10-20 · Unit bodies closer to their art
- Problem: radii of 0.3–0.55 tiles made crowds of 46–120 px sprites pile into each other.
- Choice: small 0.45, medium 0.6, large 0.85 tiles. Small bodies still pass a 1-tile gap; large ones need 2 tiles.
- Revisit if: crowds feel too loose to fit through bases.

## 2026-10-20 · Group path sharing before flow fields
- Measured: a 200-unit group order cost ~20 ticks of 8,000 expansions (6–20 ms each), and a search step cost ~1 µs.
- Choice: a faster A* (typed arrays, cached keys, no allocation; 0.34 µs per step) plus sharing within a group order (one search per cluster of members, each keeping its offset). Flow fields stay deferred: after these two, the 200-unit crossing run needs 128k expansions over 900 ticks (was 260k) and tick p95 stays under 6 ms.
- Cost: shared paths and their expiry are world state (saved, hashed).
- Revisit if: play shows lag right after big orders on the reference machine.

## 2026-10-20 · Lines are checked with the body's width
- Problem: smoothing on the centre line let paths graze corners; the wall pushed units back every tick and they stalled at the HQ corner.
- Choice: every straight leg (smoothing, joining and leaving a shared path, skipping a waypoint) checks the tiles under the body's bounding box every quarter tile, with a radius capped to what its size class fits.

## 2026-10-20 · Crowds: move on early, keep right
- Choice: an intermediate waypoint counts as passed within one radius, or within 1.5 tiles when the next one is in clear reach. Units more than 135° apart step to their right when they bump.
- Result: 80 units through the choke in 14.2 s (31 s before the waypoint rule).

## 2026-10-20 · Dev commands
- Choice: test spawning goes through a `DEV_SPAWN` command, valid only in a match created with `dev: true`, so even test tools change the world only through commands.

## 2026-10-20 · Harvest 5 s and unload 1 s, so that two carriers per crystal is the full line
- Problem: with the design's example (harvest 4 s) and crystals 2–3 tiles from the HQ, a carrier brought 1.7 ATP/s and a second carrier per crystal added only 45%: the trip was much shorter than the design's 4 s, so saturation was blurry and the economy ran fast.
- Choice: crystals about 4 tiles from the HQ, harvest 5 s, unload 1 s. Measured: one carrier per crystal 1.2–1.3 ATP/s; two per crystal 1.0 ATP/s each (the design's value); a third adds under 1%. The interface counts saturation against 2 per crystal.
- Revisit if: play wants faster openings (shorten the harvest, not the walk: the walk is what raids and depots act on).

## 2026-10-20 · Carriers pass through bodies while gathering
- Problem: with one slot per crystal, carriers queue at crystals and cross at the HQ; with pushes between them a mining line jams.
- Choice: units on a gather order neither push nor get pushed. Walls and buildings still hold them. Other units walk through a mining line.
- Revisit if: it hides too much in combat (gate 5 may turn pushes back on for carriers that flee).

## 2026-10-20 · A GATHER order spreads its carriers
- Choice: each carrier takes the crystal of the clicked field with the fewest carriers, ties to the one nearest the click; on a taken slot it moves to a free crystal next to it that nobody is heading for, or waits in line. One click sets a whole field to work.
- Cost: a player cannot stack three carriers on one crystal with a single order (it gives nothing anyway).

## 2026-10-20 · Reservations live on the target
- Choice: a work slot is an entry in the target's slot array holding the carrier's id. Releasing scans the few resources; death releases in `removeEntity`. The check after every tick in tests: every held slot has a living carrier harvesting that target, and every harvester holds exactly one.

## 2026-10-20 · Deposits and extractors are two linked entities
- Choice: a protein or iron deposit is a neutral resource with the stock; the extractor is the player's building on the same footprint, with the 3 work slots, linked both ways. Destroying the extractor leaves the deposit and its stock; emptying the deposit leaves the extractor idle.
- Until gate 4 builds things, extractors and depots come from the test lab (`DEV_SPAWN` with a building id).

## 2026-10-20 · The Colony mines from the test lab
- Choice: the client sends the Colony's opening GATHER as player 2 (test matches only), so both economies run in the arena before the AI exists (gate 6).

## 2026-10-20 · One building order at a time; placed buildings grow side by side
- The architecture says the lymph node orders buildings "in one queue", paid at the order. Choice: it holds one order; placing it frees the slot, and buildings on the map grow at the same time. Growth time on the map is the limit, and platelets are what speeds it.
- Revisit if: bases go up too fast in play (then one growing building per lymph node).

## 2026-10-20 · Friendly units step off a new building instead of delaying it
- The architecture had placement wait until friendly units cleared the site. With carriers passing through bodies, a site in a mining line could wait forever. Choice: the building appears at once and friendly units on it step to the nearest open spot; an enemy on the site still refuses it.

## 2026-10-20 · The outpost borrows the lymph node's art
- `BuildingDef.art` and `artScale` let a building draw another's picture: the lymph outpost is the lymph node at 75% on a 3x3 footprint.

## 2026-10-20 · The Colony builds in gate 6
- The Colony turns a feeder into a building on its biofilm; the biofilm layer comes with the Colony's gate. Until then the Colony trains from the buildings it has, and `QUEUE_BUILD` belongs to factions that build by order (`construction: 'order'`).

## 2026-10-20 · Projectiles are pending hits; the windup ends at launch
- The content's `windup` was "start of attack to impact". Choice: windup runs from the start of an attack to its launch; the cooldown starts at launch; flight time is distance ÷ the weapon's `speed` (new content field, 0 = lands at launch). Projectiles home on their target; `onTargetLost` decides whether one whose target died first is gone or lands at the last point.

## 2026-10-20 · Sight is a plain circle in the slice
- Membranes do not block sight yet: sight discs are cheap and the slice's walls are thin. Line of fire for ranged weapons does check membranes (a separate check, as the architecture says). Revisit for maps with large walls (sight around corners would then feel wrong).

## 2026-10-20 · Vision twice a tick, recomputed rather than saved
- Visible tiles are derived from the world at the start of the tick and after movement, so a loaded save sees exactly what an uninterrupted match sees. Explored tiles and building memory are world state (saved and hashed). Cost on the arena with 200 units: about 0.2 ms per pass.

## 2026-10-20 · The world hash is computed when read
- Hashing every tick became 10% of the tick once vision and memory joined the hash. `step` now returns the hash as a lazily computed property (read it before the next step); headless runs read it at checkpoints and at the end.

## 2026-10-20 · Idle units fight back within a leash
- An idle unit attacks what it sees and chases up to 8 tiles from where the fight began, then walks back without fighting. Attack-move has no leash. The arc's cosine comes from the content tool, since the simulation uses no trigonometry.

## 2026-10-20 · Biofilm is derived, not saved
- Biofilm is laid at the start of every tick from the cores standing in the world (radius from each core's finish tick), the same way vision is. A loaded match sees exactly the same ground, and nothing about biofilm needs to be hashed or migrated.

## 2026-10-20 · A feeder pays at the order and is refunded if the site is lost
- The architecture says the feeder becomes the building. Choice: the price is paid when the order is given (like the White Line's order at the lymph node), the site is checked again on arrival, and every way of not arriving (killed, re-ordered, site taken) refunds in full.

## 2026-10-20 · Specificity follows the family opened last
- Acquired cells get the family opened last when they finish training: +50% against it, −30% against the rest. Sampling the right enemy matters, and a second sample retrains new cells, not old ones.

## 2026-10-20 · The AI lives outside the simulation and plays through commands
- `src/ai` imports only types from the simulation (checked by a test). `src/match/aiPlayer.ts` builds its observation (`src/sim/vision/observe.ts`) when a layer is due and submits its commands 2 ticks ahead through the same queue as a player's. Vision and biofilm are recomputed before it looks, so a resumed match feeds it exactly the same observation. Its state goes into a save next to the world and the queue.
- The placement check it may ask runs on the world with the player's vision filter, like the client's preview; a hidden enemy building still occupies the navigation grid, so a site under one reads as taken. Accepted for now (the preview has the same property).

## 2026-10-20 · Units slide along walls; waypoints are passed only with a clear way on
- An AI wave stood stuck against a wall corner for minutes: a unit skipped a waypoint by distance alone and then stepped into a wall tile, and the step was undone every tick. Now a waypoint is passed only when the way to the next one is clear for the body, and a step into a wall keeps the part that stays on open ground (a slide).

## 2026-10-20 · Both deposit kinds at both bases
- The skirmish lets the player take either side, so each base has a protein deposit and an iron deposit; each faction works only its own kind.

## 2026-10-20 · Measured balance, left for the polish phase
- AI league on the arena (25 minutes at most): the stronger difficulty wins nearly every pairing. In equal-cost open fights the White Line's basic units beat the Colony's; CD8s and eosinophils lose to cheaper swarms unless specific or helped. At equal difficulty the Colony is slightly ahead. Numbers stay as they are until the campaign gives them context.
