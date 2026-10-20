# Draws a tile grid over a map painting, to trace its navigation layer by tile coordinates.
# usage: python3 grid_overlay.py <map id> <out.png> [x0 y0 x1 y1 (tiles, a crop)] [scale px per tile]
import sys
from PIL import Image, ImageDraw, ImageFont
W, H = 104, 58
mid, out = sys.argv[1], sys.argv[2]
crop = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else [0, 0, W, H]
k = int(sys.argv[7]) if len(sys.argv) >= 8 else 12
im = Image.open(f'public/assets/maps/{mid}.webp').convert('RGB').resize((W * k, H * k))
x0, y0, x1, y1 = crop
im = im.crop((x0 * k, y0 * k, x1 * k, y1 * k))
d = ImageDraw.Draw(im, 'RGBA')
font = ImageFont.load_default()
for x in range(x0, x1 + 1):
    c = (0, 0, 0, 160) if x % 10 == 0 else (0, 0, 0, 50)
    d.line([((x - x0) * k, 0), ((x - x0) * k, (y1 - y0) * k)], fill=c, width=2 if x % 10 == 0 else 1)
    if x % 5 == 0:
        d.text(((x - x0) * k + 2, 2), str(x), fill=(0, 0, 0, 255), font=font)
for y in range(y0, y1 + 1):
    c = (0, 0, 0, 160) if y % 10 == 0 else (0, 0, 0, 50)
    d.line([(0, (y - y0) * k), ((x1 - x0) * k, (y - y0) * k)], fill=c, width=2 if y % 10 == 0 else 1)
    if y % 5 == 0:
        d.text((2, (y - y0) * k + 2), str(y), fill=(0, 0, 0, 255), font=font)
im.save(out)
