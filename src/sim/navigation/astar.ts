// Grid A* for one body size. 8 directions, no corner cutting, integer costs.
// Costs: 10 straight, 14 diagonal, scaled by the current (entering a tile with the
// current is cheaper, against it dearer). The heuristic is octile distance at base cost;
// inside a current it can overestimate, which trades a little optimality for fewer
// expansions. Ties break on (f, h, tile index), so every run expands the same nodes.
//
// If the goal cannot be reached, the search returns the reachable tile closest to it.
// Written for speed: typed arrays, an index heap with keys cached, no allocation per node.

import { NavGrid } from './grid';

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const BASE = [10, 10, 10, 10, 14, 14, 14, 14];

export interface PathResult {
  /** tile nodes from start to end, as [x0, y0, x1, y1, ...] */
  nodes: number[];
  reachedGoal: boolean;
  expanded: number;
}

export class AStar {
  private readonly nav: NavGrid;
  private readonly g: Int32Array;
  private readonly f: Int32Array;
  private readonly hc: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private heap: Int32Array;
  private size = 0;
  private gen = 0;

  constructor(nav: NavGrid) {
    this.nav = nav;
    const n = nav.w * nav.h;
    this.g = new Int32Array(n);
    this.f = new Int32Array(n);
    this.hc = new Int32Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.heap = new Int32Array(n * 2);
  }

  /** a before b? (f, then h, then index) */
  private before(a: number, b: number): boolean {
    const f = this.f;
    if (f[a] !== f[b]) return f[a]! < f[b]!;
    const h = this.hc;
    if (h[a] !== h[b]) return h[a]! < h[b]!;
    return a < b;
  }

  private push(i: number): void {
    if (this.size === this.heap.length) {
      const bigger = new Int32Array(this.heap.length * 2);
      bigger.set(this.heap);
      this.heap = bigger;
    }
    const hp = this.heap;
    let k = this.size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      const pv = hp[p]!;
      if (!this.before(i, pv)) break;
      hp[k] = pv;
      k = p;
    }
    hp[k] = i;
  }

  private pop(): number {
    const hp = this.heap;
    const top = hp[0]!;
    const last = hp[--this.size]!;
    const n = this.size;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= n) break;
      const r = l + 1;
      const c = r < n && this.before(hp[r]!, hp[l]!) ? r : l;
      if (!this.before(hp[c]!, last)) break;
      hp[k] = hp[c]!;
      k = c;
    }
    if (n > 0) hp[k] = last;
    return top;
  }

  search(sx: number, sy: number, gx: number, gy: number, size: number, maxExpansions: number): PathResult {
    const nav = this.nav;
    const w = nav.w;
    const h = nav.h;
    const clr = nav.clearance;
    const fs = nav.flowStrength;
    const g = this.g;
    const f = this.f;
    const hc = this.hc;
    const parent = this.parent;
    const seen = this.seen;
    const closed = this.closed;
    this.gen++;
    if (this.gen === 0xffffffff) {
      seen.fill(0);
      closed.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    this.size = 0;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    const heur = (x: number, y: number): number => {
      const dx = x > gx ? x - gx : gx - x;
      const dy = y > gy ? y - gy : gy - y;
      return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
    };
    g[start] = 0;
    hc[start] = heur(sx, sy);
    f[start] = hc[start]!;
    parent[start] = -1;
    seen[start] = gen;
    this.push(start);
    let best = start;
    let expanded = 0;
    let reached = false;
    const ok = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && clr[y * w + x]! >= size;
    while (this.size > 0 && expanded < maxExpansions) {
      const cur = this.pop();
      if (closed[cur] === gen) continue; // stale heap entry
      closed[cur] = gen;
      expanded++;
      if (hc[cur]! < hc[best]! || (hc[cur] === hc[best] && g[cur]! < g[best]!)) best = cur;
      if (cur === goal) {
        reached = true;
        break;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const gc = g[cur]!;
      // straight moves first; diagonals need both sides free (no corner cutting)
      const east = ok(cx + 1, cy);
      const west = ok(cx - 1, cy);
      const south = ok(cx, cy + 1);
      const north = ok(cx, cy - 1);
      for (let d = 0; d < 8; d++) {
        let pass: boolean;
        switch (d) {
          case 0: pass = east; break;
          case 1: pass = west; break;
          case 2: pass = south; break;
          case 3: pass = north; break;
          case 4: pass = east && south && ok(cx + 1, cy + 1); break;
          case 5: pass = east && north && ok(cx + 1, cy - 1); break;
          case 6: pass = west && south && ok(cx - 1, cy + 1); break;
          default: pass = west && north && ok(cx - 1, cy - 1); break;
        }
        if (!pass) continue;
        const nx = cx + DX[d]!;
        const ny = cy + DY[d]!;
        const ni = ny * w + nx;
        if (closed[ni] === gen) continue;
        const base = BASE[d]!;
        const cost = fs[ni] === 0 ? base : Math.trunc((base * 1000) / nav.flowFactor(ni, DX[d]!, DY[d]!));
        const ng = gc + cost;
        if (seen[ni] !== gen || ng < g[ni]!) {
          seen[ni] = gen;
          g[ni] = ng;
          const hv = heur(nx, ny);
          hc[ni] = hv;
          f[ni] = ng + hv;
          parent[ni] = cur;
          this.push(ni);
        }
      }
    }
    // walk back from the end node, then reverse into [x0, y0, ...]
    let count = 0;
    for (let i = best; i !== -1; i = parent[i]!) {
      count++;
      if (i === start) break;
    }
    const nodes: number[] = new Array(count * 2);
    let k = count - 1;
    for (let i = best; k >= 0; i = parent[i]!, k--) {
      const x = i % w;
      nodes[2 * k] = x;
      nodes[2 * k + 1] = (i - x) / w;
    }
    return { nodes, reachedGoal: reached, expanded };
  }
}
