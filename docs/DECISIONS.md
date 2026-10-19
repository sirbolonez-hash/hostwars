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
