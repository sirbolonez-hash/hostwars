// Line of passage between tile nodes, and path smoothing ("string pulling").
// The line visits every tile the segment between the two node centres touches,
// including both neighbours when it passes exactly through a corner.

import { isqrt } from '../core/fixed';
import { centreOf, type NavGrid } from './grid';

export function lineClear(nav: NavGrid, x0: number, y0: number, x1: number, y1: number, size: number): boolean {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  let x = x0;
  let y = y0;
  let n = 1 + dx + dy;
  let err = dx - dy;
  dx *= 2;
  dy *= 2;
  for (; n > 0; n--) {
    if (!nav.passable(x, y, size)) return false;
    if (err > 0) {
      x += sx;
      err -= dy;
    } else if (err < 0) {
      y += sy;
      err += dx;
    } else {
      // exactly through a corner: both side tiles must be free too
      if (!nav.passable(x + sx, y, size) || !nav.passable(x, y + sy, size)) return false;
      x += sx;
      y += sy;
      err += dx - dy;
      n--;
    }
  }
  return true;
}

/**
 * Can a round body of radius `r` slide in a straight line from (ax, ay) to (bx, by)
 * (sub-tiles) without touching a blocked tile? Samples every quarter tile and checks the
 * tiles under the body's bounding box, which is conservative for corners.
 */
export function bodyClear(nav: NavGrid, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.max(1, Math.ceil(isqrt(dx * dx + dy * dy) / 64));
  for (let s = 0; s <= steps; s++) {
    const px = ax + Math.trunc((dx * s) / steps);
    const py = ay + Math.trunc((dy * s) / steps);
    const x0 = Math.floor((px - r) / 256);
    const x1 = Math.floor((px + r) / 256);
    const y0 = Math.floor((py - r) / 256);
    const y1 = Math.floor((py + r) / 256);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (nav.blocked(x, y)) return false;
  }
  return true;
}

/** Radius used for line checks: the body's own, but never wider than the corridor its size class fits. */
export function checkRadius(size: number, r: number): number {
  return Math.min(r, size * 128 - 8);
}

/** Body-aware line between two nodes of a body of `size`. */
export function nodesClear(nav: NavGrid, ax: number, ay: number, bx: number, by: number, size: number, r: number): boolean {
  const [px, py] = centreOf(ax, ay, size);
  const [qx, qy] = centreOf(bx, by, size);
  return bodyClear(nav, px, py, qx, qy, checkRadius(size, r));
}

/**
 * Keeps only the turning points of a tile path: from each anchor, walk forward while the
 * body can still slide straight there, and place a waypoint at the last node that worked.
 * Input and output are flat [x0, y0, x1, y1, ...] node lists; the first node is dropped.
 */
export function smoothPath(nav: NavGrid, nodes: number[], size: number, r: number): number[] {
  const n = nodes.length / 2;
  if (n <= 1) return [];
  const out: number[] = [];
  let a = 0;
  let j = 1;
  while (j < n) {
    if (j + 1 < n && nodesClear(nav, nodes[2 * a]!, nodes[2 * a + 1]!, nodes[2 * (j + 1)]!, nodes[2 * (j + 1) + 1]!, size, r)) {
      j++;
      continue;
    }
    out.push(nodes[2 * j]!, nodes[2 * j + 1]!);
    a = j;
    j = a + 1;
  }
  return out;
}
