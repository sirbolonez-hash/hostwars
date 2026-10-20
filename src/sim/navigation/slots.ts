// Arrival slots for a group move: a group sent to one point spreads over the nearest
// free tiles instead of piling onto one spot. Large bodies take a 2x2 block first,
// then the rest fill single tiles in breadth-first order from the target.

import { NavGrid } from './grid';

const RX = [1, -1, 0, 0, 1, 1, -1, -1];
const RY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Nearest tile (by rings around (tx, ty)) where a body of `size` can stand; null if none within `maxR`. */
export function nearestPassable(nav: NavGrid, tx: number, ty: number, size: number, maxR = 12): [number, number] | null {
  if (nav.passable(tx, ty, size)) return [tx, ty];
  for (let r = 1; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!nav.passable(x, y, size)) continue;
        const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

export interface SlotRequest {
  id: number;
  size: number;
  /** squared distance to the target, for ordering */
  d2: number;
}

/**
 * Returns a node (top-left tile) per unit id. Units nearer the target get slots nearer
 * the target. Deterministic: depends only on the grid, the target and the request list.
 */
export function assignSlots(nav: NavGrid, tx: number, ty: number, units: SlotRequest[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const w = nav.w;
  const taken = new Uint8Array(nav.w * nav.h);
  const order = [...units].sort((a, b) => b.size - a.size || a.d2 - b.d2 || a.id - b.id);
  const bySize = new Map<number, SlotRequest[]>();
  for (const u of order) {
    const list = bySize.get(u.size) ?? [];
    list.push(u);
    bySize.set(u.size, list);
  }
  for (const [size, list] of [...bySize.entries()].sort((a, b) => b[0] - a[0])) {
    const start = nearestPassable(nav, tx, ty, size);
    if (!start) continue;
    // breadth-first over passable nodes, taking those whose footprint is still free
    const seen = new Uint8Array(nav.w * nav.h);
    const queue: number[] = [start[1] * w + start[0]];
    seen[queue[0]!] = 1;
    let head = 0;
    let k = 0;
    const cap = list.length * 12 + 64;
    while (head < queue.length && k < list.length && head < cap) {
      const cur = queue[head++]!;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      let free = true;
      for (let y = cy; y < cy + size && free; y++) for (let x = cx; x < cx + size; x++) if (taken[y * w + x]) free = false;
      if (free) {
        for (let y = cy; y < cy + size; y++) for (let x = cx; x < cx + size; x++) taken[y * w + x] = 1;
        out.set(list[k]!.id, [cx, cy]);
        k++;
      }
      for (let d = 0; d < 8; d++) {
        const nx = cx + RX[d]!;
        const ny = cy + RY[d]!;
        if (!nav.passable(nx, ny, size)) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }
    // anyone left without a slot shares the start tile; separation spreads them later
    for (; k < list.length; k++) out.set(list[k]!.id, start);
  }
  return out;
}
