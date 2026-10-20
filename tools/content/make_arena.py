"""Grey-box test arena: every navigation case of gate 2 and the economy of gate 3, on one 104 x 58 map.

    python3 -I tools/content/make_arena.py   ->   content/maps/arena.json

Legend: '.' open tissue, '#' wall (membrane), '~' blood (open, with a current).
Layout, west to east:
  - White Line base (x 3-22), HQ at tile (8, 24)
  - wall at x = 30 with three gaps: 4 tiles wide (y 4-7), 2 tiles (y 28-29), 1 tile (y 52)
  - cell clusters (round blobs) between x 33 and 47
  - blood river x 50-55, top to bottom, current flowing south
  - a U-shaped cup at x 62-80, open to the east
  - Colony base (x 82-100), HQ at tile (90, 24)
Resources (gate 3), mirrored between the bases:
  - a home field of 8 glucose crystals (4 small 600, 4 large 1,800) in a crescent behind each HQ
  - two deposits per base, one of each kind (protein for the White Line, iron for the Colony), so
    either faction can start on either side; each is worked through its faction's extractor
  - a smaller expansion field to the north of each base, far enough that a depot there pays off
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

# --- resources: tiles are top-left; (kind, x, y) for the White Line, mirrored for the Colony ---
SMALL, LARGE = 'res_glucose_small', 'res_glucose_large'
SIZE = {SMALL: 1, LARGE: 2, 'res_protein': 2, 'res_iron': 2}
HOME = [  # crescent west of the HQ (tiles 8-11, 24-27), about 4 tiles of walking room in between
    (SMALL, 6, 19), (LARGE, 4, 20), (SMALL, 3, 22), (LARGE, 2, 24),
    (LARGE, 2, 27), (SMALL, 3, 29), (LARGE, 4, 31), (SMALL, 6, 33),
]
NORTH = [  # expansion: 2 large and 3 small, about 15 tiles from the HQ
    (LARGE, 12, 4), (SMALL, 14, 3), (SMALL, 16, 3), (LARGE, 18, 4), (SMALL, 20, 6),
]
DEPOSIT_WL = ('res_protein', 13, 19)
DEPOSIT_2 = ('res_iron', 17, 34)  # south-east of the base, clear of the start area: the other kind


def mirror(kind, x, y):
    # mirror around the HQ centres: White Line x 8-11, Colony x 90-93
    return kind, 102 - x - SIZE[kind], y


resources = []
for kind, x, y in HOME:
    resources.append({'type': kind, 'tile': [x, y], 'field': 1})
for kind, x, y in HOME:
    k, mx, my = mirror(kind, x, y)
    resources.append({'type': k, 'tile': [mx, my], 'field': 2})
for kind, x, y in NORTH:
    resources.append({'type': kind, 'tile': [x, y], 'field': 3})
for kind, x, y in NORTH:
    k, mx, my = mirror(kind, x, y)
    resources.append({'type': k, 'tile': [mx, my], 'field': 4})
resources.append({'type': DEPOSIT_WL[0], 'tile': [DEPOSIT_WL[1], DEPOSIT_WL[2]], 'field': 0})
_, ix, iy = mirror(*DEPOSIT_WL)
resources.append({'type': 'res_iron', 'tile': [ix, iy], 'field': 0})
resources.append({'type': DEPOSIT_2[0], 'tile': [DEPOSIT_2[1], DEPOSIT_2[2]], 'field': 0})
_, px, py = mirror(*DEPOSIT_2)
resources.append({'type': 'res_protein', 'tile': [px, py], 'field': 0})

# sanity: no overlaps, nothing on a wall, nothing in a 6x6 start area
taken = {}
for r in resources:
    n = SIZE[r['type']]
    for y in range(r['tile'][1], r['tile'][1] + n):
        for x in range(r['tile'][0], r['tile'][0] + n):
            assert g[y][x] != '#', f"{r} on a wall at {x},{y}"
            assert (x, y) not in taken, f"{r} overlaps {taken[(x, y)]}"
            for sx, sy in [(8, 24), (90, 24)]:
                assert not (sx <= x < sx + 6 and sy <= y < sy + 6), f"{r} inside start area"
            taken[(x, y)] = r

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
    'resources': resources,
    'fields': [
        {'id': 1, 'name': 'שדה הבית'},
        {'id': 2, 'name': 'שדה הבית של הקולוניה'},
        {'id': 3, 'name': 'השדה הצפוני'},
        {'id': 4, 'name': 'השדה הצפוני של הקולוניה'},
    ],
}
path = os.path.join(ROOT, 'content', 'maps', 'arena.json')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as f:
    json.dump(arena, f, ensure_ascii=False, indent=1)
    f.write('\n')
show = [row[:] for row in g]
for (x, y), r in taken.items():
    show[y][x] = {'res_glucose_small': 's', 'res_glucose_large': 'L', 'res_protein': 'P', 'res_iron': 'I'}[r['type']]
for sx, sy in [(8, 24), (90, 24)]:
    for y in range(sy, sy + 4):
        for x in range(sx, sx + 4):
            show[y][x] = 'H'
print('\n'.join(''.join(r) for r in show))
