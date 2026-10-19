"""Debug sheet: each FX source strip with the detected frame cells drawn on top."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from sizes import FX_BLEND
RAW, OUT = sys.argv[1], sys.argv[2]
SRC = json.load(open(os.path.join(HERE, 'source_map.json')))
def runs(mask1d, min_gap):
    idx = np.where(mask1d)[0]
    if len(idx) == 0: return []
    out, s, p = [], idx[0], idx[0]
    for v in idx[1:]:
        if v - p > min_gap: out.append((s, p + 1)); s = v
        p = v
    out.append((s, p + 1)); return out
rows = []
for aid in FX_BLEND:
    im = Image.open(os.path.join(RAW, SRC[aid]['source'])).convert('RGB')
    m = np.asarray(im).max(axis=2); content = m > 24
    bands = [b for b in runs(content.any(axis=1), 12) if b[1] - b[0] > 24]
    if aid != 'fx_pinkburst_and_toxin_glob': bands = [(bands[0][0], bands[-1][1])]
    for (by0, by1) in bands:
        band = content[by0:by1]
        cols = [r for r in runs(band.any(axis=0), 5) if r[1] - r[0] > 10]
        crop = im.crop((0, max(0, by0 - 8), im.width, min(im.height, by1 + 8))).copy()
        d = ImageDraw.Draw(crop)
        for (a, b) in cols: d.rectangle([a, 2, b, crop.height - 3], outline=(255, 255, 0), width=3)
        centers = [(a + b) / 2 for a, b in cols]; sp = np.diff(centers)
        reg = float(sp.std() / sp.mean()) if len(sp) > 1 else 9
        d.text((8, 8), f'{aid}  runs={len(cols)}  spacing_cv={reg:.2f}', fill=(255, 80, 80))
        crop.thumbnail((1400, 200)); rows.append(crop)
for s in range(0, len(rows), 14):
    chunk = rows[s:s+14]
    sheet = Image.new('RGB', (1400, sum(r.height + 6 for r in chunk)), (60, 60, 60)); y = 0
    for r in chunk: sheet.paste(r, (0, y)); y += r.height + 6
    sheet.save(os.path.join(OUT, f'fxdebug_{s // 14}.jpg'), quality=80)
print('ok', len(rows))
