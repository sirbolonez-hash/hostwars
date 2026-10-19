"""HOST WARS asset pipeline (gate 0).

Usage:
    python3 -I tools/assets/process.py <raw_dir> <out_dir>

<raw_dir> holds the uploaded folders exactly as unzipped; source_map.json maps every
asset id to its source file. The script writes game-ready files and manifest.json into
<out_dir> (normally public/assets). Sizes are display pixels at zoom 1.0; textures are
stored at 2x so they stay sharp when zoomed in.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sizes import UNIT_SIZE, BUILDING_FOOTPRINT, FX_BLEND, FX_FRAMES, TILE_PX, BUILDING_ART_SCALE, TEX_SCALE  # noqa: E402
from packer import pack_atlases  # noqa: E402

RAW, OUT = sys.argv[1], sys.argv[2]
SRC = json.load(open(os.path.join(HERE, 'source_map.json')))
os.makedirs(OUT, exist_ok=True)
manifest = {'version': 1, 'tilePx': TILE_PX, 'texScale': TEX_SCALE, 'atlases': {}, 'assets': {}}
report = []
import time
T0 = time.time()
def tick(label):
    print(f'{time.time() - T0:6.1f}s  {label}', flush=True)


def load(asset_id):
    return Image.open(os.path.join(RAW, SRC[asset_id]['source'])).convert('RGBA')


def alpha_bbox(im, thr=10):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def trim(im, pad=2):
    x0, y0, x1, y1 = alpha_bbox(im)
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def fit_long(im, long_px):
    s = long_px / max(im.width, im.height)
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def fit_width(im, w):
    s = w / im.width
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def save_webp(im, rel, q=90):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6)
    return rel


def key_black(rgb, mode):
    """Turn a black background into alpha.

    'add': true unmultiply (alpha = brightest channel); identical to the original under
    additive blending and still correct under normal blending.
    'key': soft key on dark pixels connected to the border (background and glow halos);
    dark details inside a shape (pupils, inner outlines) stay opaque. Chosen by a
    side-by-side test of four methods over light and dark ground (gate 0).
    """
    a = np.asarray(rgb.convert('RGB')).astype(np.float32)
    m = a.max(axis=2)
    if mode == 'add':
        alpha = m / 255.0
    else:
        # flood from the border through anything darker than 100: that reaches the black
        # background and the soft glow around shapes, but not the shapes themselves
        dark = m < 100
        lab, _ = ndimage.label(dark)
        edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        outside = np.isin(lab, edge[edge > 0])
        soft = np.clip((m - 8) / 140.0, 0, 1)
        alpha = np.where(outside, soft, 1.0)
    safe = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip(a / safe, 0, 255)
    fg = np.where(alpha[..., None] > 0, fg, 0)
    out = np.dstack([fg, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def runs(mask1d, min_gap):
    """Index ranges where mask1d is True, merging gaps shorter than min_gap."""
    idx = np.where(mask1d)[0]
    if len(idx) == 0:
        return []
    out, s, p = [], idx[0], idx[0]
    for v in idx[1:]:
        if v - p > min_gap:
            out.append((s, p + 1))
            s = v
        p = v
    out.append((s, p + 1))
    return out


# ---------------------------------------------------------------- units & heroes
sprites = {}  # id -> PIL image (stored at TEX_SCALE) for atlas packing
for aid, size in UNIT_SIZE.items():
    im = trim(load(aid))
    tex = fit_long(im, size * TEX_SCALE)
    x0, y0, x1, y1 = alpha_bbox(tex)
    feet_y = (y1 - 0.06 * (y1 - y0)) / tex.height
    sprites[aid] = tex
    faction = aid.split('_')[1]
    manifest['assets'][aid] = {
        'kind': 'hero' if aid.startswith('hero_') else 'unit', 'faction': faction,
        'w': round(tex.width / TEX_SCALE), 'h': round(tex.height / TEX_SCALE),
        'anchor': [0.5, round(feet_y, 3)], 'radius': round(size * 0.3), 'facing': 'left', 'flipForRight': True,
    }

tick('units')
# ---------------------------------------------------------------- buildings, host cells, resources
for aid, fp in BUILDING_FOOTPRINT.items():
    for variant in ('', '_dmg', '_alt'):
        vid = aid + variant
        if vid not in SRC:
            continue
        im = trim(load(vid))
        w_disp = fp[0] * TILE_PX * BUILDING_ART_SCALE
        tex = fit_width(im, round(w_disp * TEX_SCALE))
        sprites[vid] = tex
        kind = 'resource' if aid.startswith('res_') else ('hostcell' if '_neu_' in aid else 'building')
        manifest['assets'][vid] = {
            'kind': kind, 'faction': aid.split('_')[1] if kind != 'resource' else 'neu',
            'w': round(tex.width / TEX_SCALE), 'h': round(tex.height / TEX_SCALE),
            'anchor': [0.5, 0.7], 'footprint': list(fp), 'variantOf': aid if variant else None,
            'state': {'': 'normal', '_dmg': 'damaged', '_alt': 'alternate'}[variant],
        }

tick('buildings')
# ---------------------------------------------------------------- fx strips
def fit_runs(profile, col_runs, n):
    """Merge or split runs until there are exactly n.

    Merge: the narrowest run joins the neighbour across the smallest gap.
    Split: the widest run is cut at its emptiest column in its middle half.
    """
    r = [list(x) for x in col_runs]
    while len(r) > n:
        k = min(range(len(r)), key=lambda i: r[i][1] - r[i][0])
        left_gap = r[k][0] - r[k - 1][1] if k > 0 else 10**9
        right_gap = r[k + 1][0] - r[k][1] if k + 1 < len(r) else 10**9
        j = k - 1 if left_gap <= right_gap else k + 1
        a, b = sorted((k, j))
        r[a] = [r[a][0], r[b][1]]
        del r[b]
    while len(r) < n:
        k = max(range(len(r)), key=lambda i: r[i][1] - r[i][0])
        s0, s1 = r[k]
        lo, hi = s0 + (s1 - s0) // 4, s1 - (s1 - s0) // 4
        cut = lo + int(np.argmin(profile[lo:hi])) if hi > lo else (s0 + s1) // 2
        r[k:k + 1] = [[s0, cut], [cut, s1]]
    return [tuple(x) for x in r]


fx_frames = {}
for aid, blend in FX_BLEND.items():
    raw = load(aid)
    m = np.asarray(raw.convert('RGB')).max(axis=2)
    content = m > 24
    bands = [b for b in runs(content.any(axis=1), 12) if b[1] - b[0] > 24]
    if aid == 'fx_pinkburst_and_toxin_glob':
        names = ['fx_pinkburst', 'fx_toxin_glob']
    else:
        names = [aid]
        bands = [(bands[0][0], bands[-1][1])]
    for name, (by0, by1) in zip(names, bands):
        band = content[by0:by1]
        profile = band.sum(axis=0)
        raw_runs = [r for r in runs(band.any(axis=0), 4) if r[1] - r[0] > 3]
        n = FX_FRAMES.get(name, 8)
        cols = fit_runs(profile, raw_runs, n)
        pad = 6
        cw = max(b - a for a, b in cols) + pad * 2
        ch = (by1 - by0) + pad * 2
        frames = []
        for a, b in cols:
            piece = raw.crop((a, by0, b, by1))
            canvas = Image.new('RGB', (cw, ch), (0, 0, 0))
            canvas.paste(piece, ((cw - (b - a)) // 2, pad))
            frames.append(key_black(canvas, blend))
        long_side = max(cw, ch)
        s = min(1.0, 192 / long_side)
        frames = [f.resize((max(1, round(f.width * s)), max(1, round(f.height * s))), Image.LANCZOS) for f in frames]
        for k, f in enumerate(frames):
            sprites[f'{name}#{k:02d}'] = f
        manifest['assets'][name] = {
            'kind': 'fx', 'blend': blend, 'frames': [f'{name}#{k:02d}' for k in range(len(frames))], 'fps': 12,
            'w': round(frames[0].width / TEX_SCALE), 'h': round(frames[0].height / TEX_SCALE), 'anchor': [0.5, 0.5],
        }
        report.append((name, f'{len(raw_runs)} raw runs -> {len(cols)} frames'))

tick('fx')
# ---------------------------------------------------------------- ui pieces and icon sheets
def components(im, min_area=900):
    a = np.asarray(im)[..., 3] > 40
    lab, n = ndimage.label(ndimage.binary_closing(a, iterations=3))
    boxes = ndimage.find_objects(lab)
    out = []
    for i, sl in enumerate(boxes):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h * w < min_area:
            continue
        out.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    # reading order: rows (by centre y within 1/3 icon height), then x
    out.sort(key=lambda b: (round(((b[1] + b[3]) / 2) / max(1, (b[3] - b[1]) * 0.9)), b[0]))
    return out


ICON_SHEETS = {
    'ui_resource_icons': ['icon_atp', 'icon_oxygen', 'icon_amino', 'icon_iron', 'icon_ribosome'],
    'ui_cursors': ['cursor_select', 'cursor_move', 'cursor_attack', 'cursor_sample', 'cursor_hijack', 'cursor_invalid'],
    'ui_rank_badges': ['rank_1', 'rank_2', 'rank_3'],
    'ui_doctor_orders': ['order_antibiotic', 'order_iv_fluids', 'order_antipyretic', 'order_targeted_antibiotic',
                         'order_antiviral', 'order_steroid', 'order_vaccine', 'order_vasopressor',
                         'order_surgical', 'order_device_removal', 'order_phage', 'order_vancomycin'],
}
for sheet, names in ICON_SHEETS.items():
    im = load(sheet)
    if sheet == 'ui_doctor_orders':
        boxes = components(im)
    else:
        a = np.asarray(im)[..., 3] > 40
        col = a.sum(axis=0).astype(float)
        cr = fit_runs(col, [r for r in runs(a.any(axis=0), 10) if r[1] - r[0] > 8], len(names))
        boxes = []
        for x0, x1 in cr:
            ys = np.where(a[:, x0:x1].any(axis=1))[0]
            boxes.append((x0, int(ys.min()), x1, int(ys.max()) + 1))
    if len(boxes) != len(names):
        report.append((sheet, f'expected {len(names)} icons, found {len(boxes)}'))
    for name, b in zip(names, boxes):
        icon = fit_long(trim(im.crop(b)), 64 * TEX_SCALE)
        sprites[name] = icon
        manifest['assets'][name] = {'kind': 'icon', 'w': round(icon.width / TEX_SCALE), 'h': round(icon.height / TEX_SCALE), 'anchor': [0.5, 0.5]}

for aid in ['ui_sidebar_wl', 'ui_sidebar_col', 'ui_sidebar_crn', 'ui_monitor_frame', 'ui_inflammation_bar', 'ui_campaign_map',
            'emblem_wl', 'emblem_col', 'emblem_crn', 'brand_yak']:
    im = trim(load(aid))
    im = fit_long(im, 1024 if aid.startswith('ui_') else 512)
    rel = save_webp(im, f'ui/{aid}.webp', 92)
    manifest['assets'][aid] = {'kind': 'ui', 'file': rel, 'w': im.width, 'h': im.height}

# the logo is generated in code (tools/assets/logo), not drawn: copy the SVG and a raster
LOGO = os.path.join(HERE, 'logo')
if os.path.exists(os.path.join(LOGO, 'logo_1600.png')):
    im = Image.open(os.path.join(LOGO, 'logo_1600.png')).convert('RGBA')
    rel = save_webp(im, 'ui/logo.webp', 92)
    os.makedirs(os.path.join(OUT, 'ui'), exist_ok=True)
    with open(os.path.join(LOGO, 'logo.svg')) as fsrc, open(os.path.join(OUT, 'ui', 'logo.svg'), 'w') as fdst:
        fdst.write(fsrc.read())
    manifest['assets']['logo'] = {'kind': 'ui', 'file': rel, 'svg': 'ui/logo.svg', 'w': im.width, 'h': im.height}
tick('ui')
# ---------------------------------------------------------------- full images: maps, tiles, portraits, cinematics
for aid in [k for k in SRC if k.startswith('map_')]:
    im = load(aid).convert('RGB')
    big = im.resize((im.width * 2, im.height * 2), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    rel = save_webp(big, f'maps/{aid}.webp', 88)
    save_webp(fit_width(im, 1200), f'maps/preview/{aid}.webp', 82)
    manifest['assets'][aid] = {'kind': 'map', 'file': rel, 'preview': f'maps/preview/{aid}.webp', 'w': big.width, 'h': big.height,
                               'tiles': [big.width // TILE_PX, big.height // TILE_PX]}


def seam_error(arr):
    return float(np.abs(arr[:, 0].astype(int) - arr[:, -1].astype(int)).mean() + np.abs(arr[0].astype(int) - arr[-1].astype(int)).mean()) / 2


def make_seamless(im):
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    shifted = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    dy = np.abs(yy - (h - 1) / 2) / ((h - 1) / 2)
    dx = np.abs(xx - (w - 1) / 2) / ((w - 1) / 2)
    edge = np.maximum(dx, dy)
    wgt = np.clip((edge - 0.55) / 0.45, 0, 1)[..., None]  # 0 in the middle, 1 at the borders
    out = a * (1 - wgt) + shifted * wgt
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


for aid in [k for k in SRC if k.startswith('tile_')]:
    im = load(aid).convert('RGB')
    before = seam_error(np.asarray(im))
    fixed = make_seamless(im).resize((512, 512), Image.LANCZOS)
    after = seam_error(np.asarray(fixed))
    rel = save_webp(fixed, f'tiles/{aid}.webp', 88)
    manifest['assets'][aid] = {'kind': 'tile', 'file': rel, 'w': 512, 'h': 512}
    report.append((aid, f'seam error {before:.1f} -> {after:.1f}'))

for aid in [k for k in SRC if k.startswith('portrait_')]:
    im = load(aid).convert('RGB')
    rel = save_webp(im.resize((512, 512), Image.LANCZOS), f'portraits/{aid}.webp', 88)
    manifest['assets'][aid] = {'kind': 'portrait', 'file': rel, 'w': 512, 'h': 512}

for aid in [k for k in SRC if k.startswith('expr_')]:
    im = load(aid).convert('RGB')
    files = []
    cw = im.width / 4
    for k in range(4):
        cell = im.crop((round(k * cw), 0, round((k + 1) * cw), im.height))
        side = min(cell.width, cell.height)
        # keep more of the top: crowns, caps and hair sit above the face
        x0 = (cell.width - side) / 2
        y0 = (cell.height - side) * 0.3
        sq = cell.crop((round(x0), round(y0), round(x0 + side), round(y0 + side)))
        files.append(save_webp(sq.resize((384, 384), Image.LANCZOS), f'portraits/expr/{aid}_{k}.webp', 88))
    manifest['assets'][aid] = {'kind': 'expressions', 'files': files, 'order': ['calm', 'happy', 'angry', 'shocked']}

for aid in [k for k in SRC if k.startswith('cine_')] + ['keyart_title', 'ui_briefing_bg']:
    im = load(aid).convert('RGB')
    rel = save_webp(im, f'cine/{aid}.webp', 86)
    manifest['assets'][aid] = {'kind': 'cinematic' if aid != 'ui_briefing_bg' else 'ui', 'file': rel, 'w': im.width, 'h': im.height}

for aid in ['lineup_wl', 'lineup_col', 'lineup_crn']:
    im = load(aid).convert('RGB')
    rel = save_webp(fit_width(im, 2048), f'reference/{aid}.webp', 85)
    manifest['assets'][aid] = {'kind': 'reference', 'file': rel}

tick('full images')
# ---------------------------------------------------------------- atlases
groups = {
    'units_wl': [k for k in sprites if k.startswith(('unit_wl_', 'hero_wl_'))],
    'units_col': [k for k in sprites if k.startswith(('unit_col_', 'hero_col_'))],
    'units_crn': [k for k in sprites if k.startswith(('unit_crn_', 'hero_crn_', 'unit_neu_'))],
    'buildings_wl': [k for k in sprites if k.startswith('bld_wl_') and not k.endswith('_alt')],
    'buildings_wl_alt': [k for k in sprites if k.startswith('bld_wl_') and k.endswith('_alt')],
    'buildings_col': [k for k in sprites if k.startswith('bld_col_')],
    'buildings_crn': [k for k in sprites if k.startswith('bld_crn_')],
    'world_neutral': [k for k in sprites if k.startswith(('bld_neu_', 'res_'))],
    'icons': [k for k in sprites if k.startswith(('icon_', 'cursor_', 'rank_', 'order_'))],
}
fx_ids = sorted({k.split('#')[0] for k in sprites if '#' in k})
fx_groups = {'fx_a': fx_ids[: len(fx_ids) // 3], 'fx_b': fx_ids[len(fx_ids) // 3: 2 * len(fx_ids) // 3], 'fx_c': fx_ids[2 * len(fx_ids) // 3:]}
for g, ids in fx_groups.items():
    groups[g] = [k for k in sprites if k.split('#')[0] in ids]

for group, ids in groups.items():
    pages = pack_atlases({k: sprites[k] for k in ids}, max_size=2048, pad=2)
    page_files = []
    for p, (img, frames) in enumerate(pages):
        rel = save_webp(img, f'atlases/{group}_{p}.webp', 92)
        meta = {'frames': {}, 'meta': {'image': os.path.basename(rel), 'size': {'w': img.width, 'h': img.height}, 'scale': str(TEX_SCALE)}}
        for k, (x, y, w, h) in frames.items():
            meta['frames'][k] = {'frame': {'x': x, 'y': y, 'w': w, 'h': h}, 'rotated': False, 'trimmed': False,
                                 'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h}, 'sourceSize': {'w': w, 'h': h}}
            base = k.split('#')[0]
            if base in manifest['assets']:
                # an effect's frames can land on two pages; list every page that holds a piece of it
                pages_of = manifest['assets'][base].setdefault('atlas', [])
                if f'{group}_{p}' not in pages_of:
                    pages_of.append(f'{group}_{p}')
        json.dump(meta, open(os.path.join(OUT, f'atlases/{group}_{p}.json'), 'w'))
        page_files.append({'image': rel, 'json': f'atlases/{group}_{p}.json', 'w': img.width, 'h': img.height, 'sprites': len(frames)})
    manifest['atlases'][group] = page_files

manifest['missing'] = [] if 'logo' in manifest['assets'] else ['logo']
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
with open(os.path.join(OUT, 'pipeline_report.txt'), 'w') as f:
    for k, v in report:
        f.write(f'{k}: {v}\n')
vram = sum(p['w'] * p['h'] * 4 for pages in manifest['atlases'].values() for p in pages)
print('assets:', len(manifest['assets']), '| atlas pages:', sum(len(v) for v in manifest['atlases'].values()), f'| atlas VRAM {vram / 2**20:.0f} MiB')
