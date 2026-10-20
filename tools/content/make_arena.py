"""Gate 2 grey-box arena: every navigation case the gate must pass, on one 104 x 58 map.

    python3 -I tools/content/make_arena.py   ->   content/maps/arena.json

Legend: '.' open tissue, '#' wall (membrane), '~' blood (open, with a current).
Layout, west to east:
  - White Line base (x 3-22), HQ at tile (8, 24)
  - wall at x = 30 with three gaps: 4 tiles wide (y 4-7), 2 tiles (y 28-29), 1 tile (y 52)
  - cell clusters (round blobs) between x 33 and 47
  - blood river x 50-55, top to bottom, current flowing south
  - a U-shaped cup at x 62-80, open to the east
  - Colony base (x 82-100), HQ at tile (90, 24)
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
W, H = 104, 58
g = [['.'] * W for _ in range(H)]


def put(x, y, c):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c


def rect(x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(x, y, c)


def blob(cx, cy, r):
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r + r:
                put(x, y, '#')


# border
rect(0, 0, W - 1, 0, '#')
rect(0, H - 1, W - 1, H - 1, '#')
rect(0, 0, 0, H - 1, '#')
rect(W - 1, 0, W - 1, H - 1, '#')

# the dividing wall with a wide, a narrow and a one-tile gap
rect(30, 1, 31, H - 2, '#')
rect(30, 4, 31, 7, '.')     # 4 wide
rect(30, 28, 31, 29, '.')   # 2 wide: the choke of the gate 2 acceptance test
rect(30, 52, 31, 52, '.')   # 1 wide: small and medium units only

# cell clusters
for cx, cy, r in [(36, 12, 2), (42, 18, 3), (37, 38, 2), (44, 44, 3), (40, 50, 1), (46, 8, 1), (35, 24, 1)]:
    blob(cx, cy, r)

# blood river with two cell islands
rect(50, 1, 55, H - 2, '~')
blob(52, 16, 1)
blob(53, 40, 1)

# U-shaped cup, open to the east
rect(62, 14, 80, 15, '#')
rect(62, 40, 80, 41, '#')
rect(62, 14, 63, 41, '#')

# a few cells in the east
for cx, cy, r in [(70, 6, 2), (72, 50, 2), (86, 46, 1)]:
    blob(cx, cy, r)

# keep both bases clear
rect(3, 16, 22, 40, '.')
rect(82, 16, 101, 40, '.')

arena = {
    'id': 'arena',
    'name': 'מגרש אימונים',
    'w': W,
    'h': H,
    'ground': 'tile_tissue',
    'legend': {'.': 'open', '#': 'wall', '~': 'blood'},
    'rows': [''.join(r) for r in g],
    # current: direction as a vector, strength in thousandths (1000 = twice as fast downstream, half upstream)
    'flows': [{'rect': [50, 1, 6, H - 2], 'dir': [0, 1], 'strength': 1000}],
    'starts': [[8, 24], [90, 24]],
}
path = os.path.join(ROOT, 'content', 'maps', 'arena.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump(arena, f, ensure_ascii=False, indent=1)
    f.write('\n')
print('\n'.join(arena['rows']))
