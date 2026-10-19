"""Builds the English HOST WARS logo as a self-contained SVG (no fonts needed at runtime).

Letters come from Luckiest Guy (Apache-2.0, npm @fontsource/luckiest-guy) converted to paths.
The O of HOST is a smiling White Line cell, a Colony bacterium peeks from behind the H,
and a Crown gem virus sits on the last S.

    python3 -I tools/assets/logo/make_logo.py   ->   tools/assets/logo/logo.svg
"""
import math
import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FONT = os.path.join(ROOT, 'node_modules/@fontsource/luckiest-guy/files/luckiest-guy-latin-400-normal.woff')

PLUM = '#2a1530'
font = TTFont(FONT)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
CAP = 1424  # font units
S = 300 / CAP  # cap height 300 px
W_, H_ = 1700, 575
BASE = 480  # baseline y


def glyph_path(ch, x, y, scale, rot=0.0):
    name = cmap[ord(ch)]
    adv = font['hmtx'][name][0]
    pen = SVGPathPen(gs)
    # font units -> px, y flipped, rotated about the glyph's centre
    cx, cy = adv * scale / 2, -CAP * scale / 2
    a = math.radians(rot)
    ca, sa = math.cos(a), math.sin(a)
    # fontTools matrix (xx, xy, yx, yy, dx, dy): x' = xx*x + yx*y + dx, y' = xy*x + yy*y + dy.
    # local (u, v) = (s*x, -s*y), rotated by `rot` about the glyph centre (cx, cy), then moved to (x, y)
    tx = x + cx - (ca * cx - sa * cy)
    ty = y + cy - (sa * cx + ca * cy)
    xx, xy = scale * ca, scale * sa
    yx, yy = scale * sa, -scale * ca
    tp = TransformPen(pen, (xx, xy, yx, yy, tx, ty))
    gs[name].draw(tp)
    return pen.getCommands(), adv * scale


def letter_layers(d, fill_id, gloss_id, clip_id):
    return f'''
  <clipPath id="{clip_id}"><path d="{d}"/></clipPath>
  <path d="{d}" transform="translate(7 13)" fill="{PLUM}" opacity="0.35"/>
  <path d="{d}" fill="none" stroke="{PLUM}" stroke-width="40" stroke-linejoin="round"/>
  <path d="{d}" fill="none" stroke="url(#gold)" stroke-width="24" stroke-linejoin="round"/>
  <path d="{d}" fill="url(#{fill_id})"/>
  <g clip-path="url(#{clip_id})"><rect x="0" y="0" width="4000" height="{BASE - 150}" fill="url(#{gloss_id})"/></g>
  <path d="{d}" fill="none" stroke="{PLUM}" stroke-width="3" opacity="0.5"/>'''


def cell(cx, cy, r):
    """The O: a round milk-white cell with a face."""
    return f'''
  <g>
    <circle cx="{cx + 7}" cy="{cy + 13}" r="{r}" fill="{PLUM}" opacity="0.35"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{PLUM}" stroke-width="40"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="url(#gold)" stroke-width="24"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#cellFill)"/>
    <ellipse cx="{cx - r * 0.18}" cy="{cy - r * 0.52}" rx="{r * 0.55}" ry="{r * 0.22}" fill="#ffffff" opacity="0.75"/>
    <circle cx="{cx + r * 0.42}" cy="{cy + r * 0.38}" r="{r * 0.16}" fill="#9fc8ff" opacity="0.7"/>
    <circle cx="{cx - r * 0.5}" cy="{cy + r * 0.28}" r="{r * 0.1}" fill="#9fc8ff" opacity="0.6"/>
    <ellipse cx="{cx - r * 0.33}" cy="{cy - r * 0.05}" rx="{r * 0.17}" ry="{r * 0.24}" fill="{PLUM}"/>
    <ellipse cx="{cx + r * 0.33}" cy="{cy - r * 0.05}" rx="{r * 0.17}" ry="{r * 0.24}" fill="{PLUM}"/>
    <circle cx="{cx - r * 0.28}" cy="{cy - r * 0.14}" r="{r * 0.07}" fill="#ffffff"/>
    <circle cx="{cx + r * 0.38}" cy="{cy - r * 0.14}" r="{r * 0.07}" fill="#ffffff"/>
    <ellipse cx="{cx - r * 0.62}" cy="{cy + r * 0.25}" rx="{r * 0.15}" ry="{r * 0.09}" fill="#ff9aa2" opacity="0.8"/>
    <ellipse cx="{cx + r * 0.62}" cy="{cy + r * 0.25}" rx="{r * 0.15}" ry="{r * 0.09}" fill="#ff9aa2" opacity="0.8"/>
    <path d="M {cx - r * 0.2} {cy + r * 0.3} Q {cx} {cy + r * 0.52} {cx + r * 0.2} {cy + r * 0.3}" fill="none" stroke="{PLUM}" stroke-width="{r * 0.07}" stroke-linecap="round"/>
  </g>'''


def bacterium(x, y, rot):
    """A cheeky lime rod peeking from behind the H."""
    return f'''
  <g transform="translate({x} {y}) rotate({rot})">
    <path d="M -10 -46 C 30 -110, 70 -120, 95 -150" fill="none" stroke="{PLUM}" stroke-width="13" stroke-linecap="round"/>
    <path d="M -10 -46 C 30 -110, 70 -120, 95 -150" fill="none" stroke="#a6e22e" stroke-width="6" stroke-linecap="round"/>
    <rect x="-60" y="-55" width="120" height="190" rx="60" fill="{PLUM}"/>
    <rect x="-52" y="-47" width="104" height="174" rx="52" fill="url(#lime)"/>
    <ellipse cx="-14" cy="-20" rx="26" ry="12" fill="#ffffff" opacity="0.55"/>
    <circle cx="-22" cy="20" r="15" fill="#ffffff" stroke="{PLUM}" stroke-width="5"/>
    <circle cx="20" cy="20" r="15" fill="#ffffff" stroke="{PLUM}" stroke-width="5"/>
    <circle cx="-18" cy="24" r="7" fill="{PLUM}"/>
    <circle cx="24" cy="24" r="7" fill="{PLUM}"/>
    <path d="M -24 52 Q 0 74 26 50" fill="#e0662c" stroke="{PLUM}" stroke-width="5" stroke-linejoin="round"/>
    <rect x="-4" y="54" width="10" height="10" rx="2" fill="#ffffff" stroke="{PLUM}" stroke-width="2"/>
    <circle cx="30" cy="90" r="7" fill="#7bb51f"/>
    <circle cx="-30" cy="100" r="5" fill="#7bb51f"/>
  </g>'''


def gem_virus(x, y, r):
    """A smug violet gem virus wearing a little crown."""
    pts = []
    for k in range(8):
        a = math.radians(22.5 + k * 45)
        pts.append(f'{x + r * math.cos(a):.1f},{y + r * math.sin(a):.1f}')
    spikes = ''
    for k in range(8):
        a = math.radians(k * 45)
        x1, y1 = x + r * 0.95 * math.cos(a), y + r * 0.95 * math.sin(a)
        x2, y2 = x + r * 1.42 * math.cos(a), y + r * 1.42 * math.sin(a)
        if k in (6,):  # leave the top free for the crown
            continue
        spikes += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{PLUM}" stroke-width="13" stroke-linecap="round"/>'
        spikes += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#bff5e6" stroke-width="6" stroke-linecap="round"/>'
        spikes += f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="11" fill="#ff4fb8" stroke="{PLUM}" stroke-width="5"/>'
    facets = (f'<polygon points="{x},{y - r * 0.92} {x + r * 0.62},{y - r * 0.3} {x},{y - r * 0.05} {x - r * 0.62},{y - r * 0.3}" fill="#c58cff" opacity="0.8"/>'
              f'<polygon points="{x - r * 0.9},{y + r * 0.1} {x - r * 0.3},{y + r * 0.2} {x - r * 0.5},{y + r * 0.8}" fill="#6a2bc0" opacity="0.6"/>')
    crown = (f'<path d="M {x - r * 0.45} {y - r * 0.85} L {x - r * 0.5} {y - r * 1.35} L {x - r * 0.2} {y - r * 1.1} L {x} {y - r * 1.5} '
             f'L {x + r * 0.2} {y - r * 1.1} L {x + r * 0.5} {y - r * 1.35} L {x + r * 0.45} {y - r * 0.85} Z" fill="url(#gold)" stroke="{PLUM}" stroke-width="6" stroke-linejoin="round"/>'
             f'<circle cx="{x}" cy="{y - r * 1.02}" r="{r * 0.09}" fill="#e8173f" stroke="{PLUM}" stroke-width="3"/>')
    face = (f'<path d="M {x - r * 0.48} {y + r * 0.02} Q {x - r * 0.3} {y - r * 0.08} {x - r * 0.12} {y + r * 0.02}" fill="none" stroke="{PLUM}" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M {x + r * 0.12} {y + r * 0.02} Q {x + r * 0.3} {y - r * 0.08} {x + r * 0.48} {y + r * 0.02}" fill="none" stroke="{PLUM}" stroke-width="7" stroke-linecap="round"/>'
            f'<ellipse cx="{x - r * 0.3}" cy="{y + r * 0.12}" rx="{r * 0.13}" ry="{r * 0.08}" fill="#e8173f"/>'
            f'<ellipse cx="{x + r * 0.3}" cy="{y + r * 0.12}" rx="{r * 0.13}" ry="{r * 0.08}" fill="#e8173f"/>'
            f'<path d="M {x - r * 0.2} {y + r * 0.42} Q {x + r * 0.05} {y + r * 0.55} {x + r * 0.28} {y + r * 0.36}" fill="none" stroke="{PLUM}" stroke-width="7" stroke-linecap="round"/>')
    return f'''
  <g>
    {spikes}
    <polygon points="{' '.join(pts)}" fill="{PLUM}" transform="translate({x} {y}) scale(1.12) translate({-x} {-y})"/>
    <polygon points="{' '.join(pts)}" fill="url(#gem)"/>
    {facets}{face}{crown}
  </g>'''


def build():
    letters = []
    x = 70
    angles = {'H': -5, 'S': 4, 'T': -3, 'W': 3, 'A': -4, 'R': 5, 'S2': -3}
    lifts = {'H': 6, 'S': -10, 'T': 4, 'W': -6, 'A': 8, 'R': -4, 'S2': 4}
    word1 = ['H', 'O', 'S', 'T']
    word2 = ['W', 'A', 'R', 'S2']
    positions = {}
    for ch in word1:
        if ch == 'O':
            adv = font['hmtx'][cmap[ord('O')]][0] * S
            positions['O'] = (x + adv / 2, BASE - 150, adv * 0.5)
            x += adv - 18
            continue
        d, adv = glyph_path(ch, x, BASE - lifts[ch], S, angles[ch])
        letters.append((ch, d, 'fillHost'))
        positions[ch] = (x, adv)
        x += adv - 18
    x += 70
    s2 = S * 1.08
    for key in word2:
        ch = key[0]
        d, adv = glyph_path(ch, x, BASE + 20 - lifts[key], s2, angles[key])
        letters.append((key, d, 'fillWars'))
        positions[key] = (x, adv)
        x += adv - 20
    width = x + 70
    defs = f'''
  <linearGradient id="fillHost" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#eef6ff"/><stop offset="1" stop-color="#7cb8ff"/></linearGradient>
  <linearGradient id="fillWars" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#9fd0ff"/><stop offset="0.5" stop-color="#4a9bff"/><stop offset="1" stop-color="#2c6fd8"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffe27a"/><stop offset="0.5" stop-color="#ffc83d"/><stop offset="1" stop-color="#d98b10"/></linearGradient>
  <linearGradient id="gloss" x1="0" y1="{BASE - 330}" x2="0" y2="{BASE - 150}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.75"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <radialGradient id="cellFill" cx="0.42" cy="0.38" r="0.7">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#f3f8ff"/><stop offset="1" stop-color="#8cc2ff"/></radialGradient>
  <linearGradient id="lime" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#d4f56b"/><stop offset="0.6" stop-color="#a6e22e"/><stop offset="1" stop-color="#6fa81c"/></linearGradient>
  <linearGradient id="gem" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b47cff"/><stop offset="0.6" stop-color="#8e44ec"/><stop offset="1" stop-color="#5e1fb0"/></linearGradient>'''
    body = []
    hx, hadv = positions['H']
    body.append(bacterium(hx + hadv * 0.8, BASE - 352, 24))
    for i, (key, d, fill) in enumerate(letters):
        if key == 'S2':
            continue
        body.append(letter_layers(d, fill, 'gloss', f'clip{i}'))
        if key == 'H':
            cx, cy, r = positions['O']
            body.append(cell(cx, cy, r))
    i = [k for k, _, _ in letters].index('S2')
    body.append(letter_layers(letters[i][1], letters[i][2], 'gloss', 'clipS2'))
    sx, sadv = positions['S2']
    body.append(gem_virus(sx + sadv * 0.58, BASE - 372, 62))
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {H_}" width="{width:.0f}" height="{H_}">
<title>HOST WARS</title>
<defs>{defs}
</defs>
{''.join(body)}
</svg>
'''
    out = os.path.join(HERE, 'logo.svg')
    with open(out, 'w') as f:
        f.write(svg)
    print('wrote', out, f'{width:.0f}x{H_}')


build()
