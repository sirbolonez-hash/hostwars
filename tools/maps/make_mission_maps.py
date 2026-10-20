# Navigation layers for the painted mission maps (m01–m03), traced over the paintings.
#
# Each map is 104x58 tiles over a 3344x1882 painting. Shapes in tile coordinates mark what
# cannot be walked (cliffs, keratin, fat, the capsule), lymph vessels (walkable, a one-way
# current three times as fast) and special zones. The tool writes content/maps/<id>.json
# and, with --preview, an overlay of the layer on the painting to check the tracing by eye.
#
# usage: python3 tools/maps/make_mission_maps.py [--preview <dir>]

import json
import math
import os
import sys

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
W, H = 104, 58


class Layer:
    def __init__(self):
        self.g = [['.'] * W for _ in range(H)]
        self.flow = {}  # (x, y) -> (dx, dy, strength)
        self.zone = {}  # (x, y) -> zone letter

    def each(self, inside, c):
        for y in range(H):
            for x in range(W):
                if inside(x + 0.5, y + 0.5):
                    self.g[y][x] = c

    def ellipse(self, cx, cy, rx, ry, c='#'):
        self.each(lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, c)

    def ring(self, cx, cy, rx, ry, t, c='#'):
        def inside(x, y):
            o = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            i = ((x - cx) / (rx - t)) ** 2 + ((y - cy) / (ry - t)) ** 2
            return o <= 1 and i > 1
        self.each(inside, c)

    def outside(self, cx, cy, rx, ry, c='#'):
        self.each(lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1, c)

    def rect(self, x0, y0, x1, y1, c='#'):
        for y in range(max(0, y0), min(H, y1)):
            for x in range(max(0, x0), min(W, x1)):
                self.g[y][x] = c

    def poly(self, pts, c='#'):
        def inside(x, y):
            n = len(pts)
            hit = False
            j = n - 1
            for i in range(n):
                xi, yi = pts[i]
                xj, yj = pts[j]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    hit = not hit
                j = i
            return hit
        self.each(inside, c)

    def line(self, pts, width, c='#', flow=None):
        """A thick polyline; with flow=strength, its tiles get a current along the line."""
        r = width / 2
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            dx, dy = bx - ax, by - ay
            ln = math.hypot(dx, dy)
            for y in range(H):
                for x in range(W):
                    px, py = x + 0.5, y + 0.5
                    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (ln * ln)))
                    qx, qy = ax + t * dx, ay + t * dy
                    if math.hypot(px - qx, py - qy) <= r:
                        self.g[y][x] = c
                        if flow:
                            self.flow[(x, y)] = (round(dx / ln * 1000), round(dy / ln * 1000), flow)

    def zone_ellipse(self, cx, cy, rx, ry, z):
        for y in range(H):
            for x in range(W):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1 and self.g[y][x] == '.':
                    self.zone[(x, y)] = z

    def open(self, x0, y0, x1, y1):
        self.rect(x0, y0, x1, y1, '.')


# ---------------------------------------------------------------- m01 · the scratch

def m01():
    L = Layer()
    # keratin: the dead top layer, a cliff all along the top
    for x in range(W):
        bottom = 9 if x < 14 else 10 if x < 30 else 11 if x < 62 else 13 if x < 88 else 15
        L.rect(x, 0, x + 1, bottom)
    # the hair shaft and its follicle wall (a tunnel runs beside it), sebaceous glands
    L.poly([(7, 0), (13, 0), (13, 28), (11, 30), (8, 30), (7, 28)])
    L.ellipse(3.5, 26, 2.5, 5)
    L.ellipse(14.5, 21, 2.2, 3.5)
    # the sweat gland and its coil (an obstacle on the east)
    L.ellipse(95, 28, 8.5, 11)
    L.line([(97, 8), (97, 18)], 2.4)
    # the wound: a crater of torn tissue with a rim of cliffs, open at three gaps
    L.ring(51, 25, 22, 13.5, 4.2)
    L.open(47, 34, 56, 40)   # south gap, where the pool spills out
    L.open(27, 23, 34, 29)   # west gap
    L.open(69, 26, 76, 31)   # east gap
    # the rusty splinter stuck in the wound
    L.poly([(44, 14), (48, 13), (59, 28), (56, 30), (52, 29)])
    # the capillary loops at the bottom: vessels (not walkable here), the deep layer below
    L.rect(0, 40, W, H)
    return L, {
        'id': 'm01', 'name': 'השריטה', 'art': 'map_m01_skin',
        # the White Line arrives through the exit gates on the vessels (no base): the start tile is a marker
        'starts': [[18, 30], [76, 19]],
        'resources': [], 'fields': [],
    }


# ---------------------------------------------------------------- m02 · inflammation

def m02():
    L = Layer()
    # the vessels down both sides
    L.rect(0, 0, 10, H)
    L.rect(93, 0, W, H)
    # fat lobules: the obstacles the collagen corridors run between
    for cx, cy, rx, ry in [
        (21, 12, 4.5, 4), (37, 4, 5, 3.5), (52, 15, 5, 4.2), (70, 3, 5.5, 3), (66, 22, 5, 4),
        (88, 19, 4, 5), (45, 28, 5.5, 4.5), (76, 32, 5, 4), (88, 38, 5, 5), (40, 46, 6, 5),
        (68, 46, 6, 4.5), (54, 54, 5.5, 3.5), (76, 54, 5, 3.5), (21, 50, 6, 5.5), (16, 22, 4, 3),
    ]:
        L.ellipse(cx, cy, rx, ry)
    # the lymph vessel in the north-east: where the infection must not get to
    L.line([(76, 4), (86, 6), (96, 4), (104, 1)], 5, 'l', flow=1600)
    return L, {
        'id': 'm02', 'name': 'דלקת', 'art': 'map_m02_subcutis',
        'starts': [[80, 25], [16, 30]],
        'resources': [
            {'type': 'res_glucose_large', 'tile': [84, 10], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [87, 9], 'field': 1},
            {'type': 'res_glucose_large', 'tile': [89, 11], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [90, 14], 'field': 1},
            {'type': 'res_glucose_large', 'tile': [87, 24], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [90, 27], 'field': 1},
            {'type': 'res_glucose_large', 'tile': [87, 29], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [90, 30], 'field': 1},
            {'type': 'res_protein', 'tile': [74, 22], 'field': 0},
            {'type': 'res_glucose_large', 'tile': [58, 36], 'field': 2},
            {'type': 'res_glucose_small', 'tile': [61, 35], 'field': 2},
            {'type': 'res_glucose_large', 'tile': [60, 39], 'field': 2},
            {'type': 'res_glucose_small', 'tile': [57, 40], 'field': 2},
            {'type': 'res_iron', 'tile': [12, 38], 'field': 0},
        ],
        'fields': [{'id': 1, 'name': 'שדה הווריד'}, {'id': 2, 'name': 'שדה המרכז'}],
    }


# ---------------------------------------------------------------- m03 · the node

NODE = (54, 26.5, 45, 23.5)  # centre and radii of the capsule's outer edge


def m03():
    L = Layer()
    cx, cy, rx, ry = NODE
    # fat outside the node, the capsule around it
    L.outside(cx, cy, rx, ry)
    L.ring(cx, cy, rx, ry, 3.2)
    # the lymph vessels: four in from the north and west (the attack lanes), one out to the south
    lanes = [
        [(0, 6), (10, 9), (19, 16)],       # west, upper
        [(0, 33), (9, 32), (17, 31)],      # west, lower
        [(31, 0), (32, 4), (33, 9)],       # north
        [(85, 0), (83, 4), (80, 9)],       # north-east
    ]
    for pts in lanes:
        L.line(pts, 4, 'l', flow=1600)
    L.line([(59, 0), (59, 4), (59, 10)], 3.6, 'l', flow=1600)  # the north vessel into the medulla
    L.line([(58, 44), (58, 50), (58, 58)], 4, 'l', flow=1600)  # out, to the south
    # follicles (B zones) and the paracortex around them (T zone)
    for fx, fy in [(39, 11), (73, 11), (24, 32), (87, 31)]:
        L.zone_ellipse(fx, fy, 5.2, 4.6, 'B')
    for fx, fy in [(31, 21), (80, 21), (36, 38), (74, 38)]:
        L.zone_ellipse(fx, fy, 6.5, 4.5, 'T')
    return L, {
        'id': 'm03', 'name': 'הצומת', 'art': 'map_m03_lymphnode',
        'starts': [[50, 30], [2, 6]],
        'resources': [
            {'type': 'res_glucose_large', 'tile': [44, 30], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [43, 33], 'field': 1},
            {'type': 'res_glucose_large', 'tile': [44, 36], 'field': 1},
            {'type': 'res_glucose_small', 'tile': [47, 38], 'field': 1},
            {'type': 'res_glucose_large', 'tile': [62, 29], 'field': 2},
            {'type': 'res_glucose_small', 'tile': [65, 31], 'field': 2},
            {'type': 'res_glucose_large', 'tile': [63, 35], 'field': 2},
            {'type': 'res_protein', 'tile': [52, 40], 'field': 0},
        ],
        'fields': [{'id': 1, 'name': 'שדה המדולה המערבי'}, {'id': 2, 'name': 'שדה המדולה המזרחי'}],
    }


def build(maker):
    L, meta = maker()
    # the start areas must be open
    for sx, sy in meta['starts']:
        if meta['id'] == 'm01':
            continue
        L.open(sx, sy, sx + 6, sy + 6)
    flows = [{'rect': [x, y, 1, 1], 'dir': [dx, dy], 'strength': s} for (x, y), (dx, dy, s) in sorted(L.flow.items(), key=lambda kv: (kv[0][1], kv[0][0]))]
    zones = {}
    for (x, y), z in sorted(L.zone.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        zones.setdefault(z, []).append(y * W + x)
    data = {
        'id': meta['id'], 'name': meta['name'], 'w': W, 'h': H, 'ground': 'tile_tissue', 'art': meta['art'],
        'legend': {'.': 'open', '#': 'wall', '~': 'blood', 'l': 'blood'},
        'rows': [''.join(r) for r in L.g],
        'flows': flows,
        'starts': meta['starts'],
        'resources': meta['resources'],
        'fields': meta['fields'],
        'zones': [{'kind': z, 'tiles': t} for z, t in sorted(zones.items())],
    }
    return L, data


def preview(L, data, out):
    from PIL import Image, ImageDraw
    k = 16
    im = Image.open(os.path.join(ROOT, 'public', 'assets', 'maps', data['art'] + '.webp')).convert('RGB').resize((W * k, H * k))
    d = ImageDraw.Draw(im, 'RGBA')
    for y in range(H):
        for x in range(W):
            c = L.g[y][x]
            col = (200, 0, 40, 110) if c == '#' else (0, 120, 255, 110) if c == 'l' else None
            z = L.zone.get((x, y))
            if z == 'B':
                col = (255, 230, 0, 70)
            if z == 'T':
                col = (0, 200, 120, 60)
            if col:
                d.rectangle([x * k, y * k, x * k + k - 1, y * k + k - 1], fill=col)
    for r in data['resources']:
        x, y = r['tile']
        d.rectangle([x * k, y * k, x * k + 2 * k - 1, y * k + 2 * k - 1], outline=(255, 255, 255, 255), width=2)
    for sx, sy in data['starts']:
        d.rectangle([sx * k, sy * k, (sx + 4) * k, (sy + 4) * k], outline=(0, 0, 0, 255), width=3)
    im.resize((W * 12, H * 12)).save(out)


if __name__ == '__main__':
    out_dir = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    for maker in (m01, m02, m03):
        L, data = build(maker)
        path = os.path.join(ROOT, 'content', 'maps', data['id'] + '.json')
        with open(path, 'w') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write('\n')
        if out_dir:
            preview(L, data, os.path.join(out_dir, f"nav_{data['id']}.png"))
        print(data['id'], sum(r.count('#') for r in data['rows']), 'wall tiles,', len(data['flows']), 'flow tiles')
