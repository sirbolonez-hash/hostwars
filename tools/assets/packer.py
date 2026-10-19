"""Small MaxRects (best short side fit) atlas packer. Deterministic: same input, same layout."""
from PIL import Image


class MaxRects:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.free = [(0, 0, w, h)]

    def insert(self, rw, rh):
        best, best_score = None, None
        for fx, fy, fw, fh in self.free:
            if rw <= fw and rh <= fh:
                score = (min(fw - rw, fh - rh), max(fw - rw, fh - rh))
                if best_score is None or score < best_score:
                    best, best_score = (fx, fy, rw, rh), score
        if best is None:
            return None
        self._split(best)
        return best

    def _split(self, used):
        ux, uy, uw, uh = used
        kept, new = [], []
        for fx, fy, fw, fh in self.free:
            if ux >= fx + fw or ux + uw <= fx or uy >= fy + fh or uy + uh <= fy:
                kept.append((fx, fy, fw, fh))
                continue
            if ux > fx:
                new.append((fx, fy, ux - fx, fh))
            if ux + uw < fx + fw:
                new.append((ux + uw, fy, fx + fw - ux - uw, fh))
            if uy > fy:
                new.append((fx, fy, fw, uy - fy))
            if uy + uh < fy + fh:
                new.append((fx, uy + uh, fw, fy + fh - uy - uh))

        def inside(a, b):
            return a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3]

        # only the new pieces can be redundant: kept rectangles were already maximal
        uniq = []
        for i, a in enumerate(new):
            if any(inside(a, b) and (a != b or j < i) for j, b in enumerate(new) if j != i):
                continue
            if any(inside(a, b) for b in kept):
                continue
            uniq.append(a)
        self.free = kept + uniq


def _pow2_at_least(v):
    p = 64
    while p < v:
        p *= 2
    return p


def _try_single(images, order, w, h, pad):
    packer = MaxRects(w, h)
    placed = {}
    for k in order:
        r = packer.insert(images[k].width + pad * 2, images[k].height + pad * 2)
        if r is None:
            return None
        placed[k] = (r[0] + pad, r[1] + pad, images[k].width, images[k].height)
    return placed


def pack_atlases(images, max_size=2048, pad=2):
    """images: {name: PIL RGBA}. Returns [(page_image, {name: (x, y, w, h)})].

    One page in the smallest power-of-two size that fits everything; otherwise
    as many max_size pages as needed.
    """
    order = sorted(images, key=lambda k: (-images[k].height, -images[k].width, k))
    area = sum((im.width + pad * 2) * (im.height + pad * 2) for im in images.values())
    sizes = sorted({(w, h) for w in (256, 512, 1024, 2048) for h in (256, 512, 1024, 2048) if w <= max_size and h <= max_size},
                   key=lambda s: (s[0] * s[1], max(s)))
    for w, h in sizes:
        if w * h < area:
            continue
        placed = _try_single(images, order, w, h, pad)
        if placed:
            page = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            for k, (x, y, pw, ph) in placed.items():
                page.paste(images[k], (x, y))
            return [(page, placed)]
    pages = []
    remaining = list(order)
    while remaining:
        packer = MaxRects(max_size, max_size)
        placed, rest = {}, []
        for k in remaining:
            im = images[k]
            r = packer.insert(im.width + pad * 2, im.height + pad * 2)
            if r is None:
                rest.append(k)
            else:
                placed[k] = (r[0] + pad, r[1] + pad, im.width, im.height)
        if not placed:
            raise ValueError(f'sprite too large for atlas: {remaining[0]}')
        used_w = _pow2_at_least(max(x + w + pad for x, y, w, h in placed.values()))
        used_h = _pow2_at_least(max(y + h + pad for x, y, w, h in placed.values()))
        page = Image.new('RGBA', (used_w, used_h), (0, 0, 0, 0))
        for k, (x, y, w, h) in placed.items():
            page.paste(images[k], (x, y))
        pages.append((page, placed))
        remaining = rest
    return pages
