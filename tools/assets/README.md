# Asset pipeline

Turns Yakir's raw images into game-ready files in `public/assets`.

```bash
# raw images: the uploaded folders, unzipped as they are, next to the repo
python3 -I tools/assets/process.py ../host-wars-raw public/assets
node tools/check-assets.mjs
```

| File | Role |
| --- | --- |
| `source_map.json` | asset id → original file (the uploads are named by ChatGPT timestamps) |
| `sizes.py` | display sizes, building footprints, effect blend modes and frame counts — the only place to tune |
| `process.py` | keying, trimming, scaling, frame cutting, seamless tiles, map upscale, atlases, manifest |
| `packer.py` | deterministic MaxRects atlas packer |
| `debug_fx.py` | draws the detected frame cuts over every effect strip, for checking a new strip |

Adding a new image: put it in the raw folder, add its id to `source_map.json`, add its size or footprint to `sizes.py`, rerun.

Requires Python 3 with Pillow, NumPy and SciPy. Needs about 4 minutes for the full set.
