// The navigation grid: what is passable for each body size, and where the current flows.
// Static terrain comes from the map; building footprints are stamped on top and can be
// removed again. Everything is integer and typed-array based.

import { isqrt, SUB } from '../core/fixed';
import type { MapDef, NavClass, TerrainKind } from '../content/types';

/** Side of the square (in tiles) a body needs. Large bodies path on the top-left tile of a 2x2. */
export const CLASS_SIZE: Record<NavClass, number> = { small: 1, medium: 1, large: 2 };
const MAX_CLEARANCE = 4;

export const T_OPEN = 0;
export const T_WALL = 1;
export const T_BLOOD = 2;
const TERRAIN_CODE: Record<TerrainKind, number> = { open: T_OPEN, wall: T_WALL, blood: T_BLOOD };

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly terrain: Uint8Array;
  /** walls from the map */
  readonly staticBlocked: Uint8Array;
  /** number of building footprints covering each tile */
  readonly occupied: Uint16Array;
  /** largest free square with this tile as its top-left corner, capped */
  readonly clearance: Uint8Array;
  /** current per tile: unit direction scaled to 256, and strength in thousandths */
  readonly flowX: Int16Array;
  readonly flowY: Int16Array;
  readonly flowStrength: Int16Array;
  /** grows whenever passability changes, so cached paths know they are stale */
  version = 0;

  constructor(map: MapDef) {
    this.w = map.w;
    this.h = map.h;
    const n = map.w * map.h;
    this.terrain = new Uint8Array(n);
    this.staticBlocked = new Uint8Array(n);
    this.occupied = new Uint16Array(n);
    this.clearance = new Uint8Array(n);
    this.flowX = new Int16Array(n);
    this.flowY = new Int16Array(n);
    this.flowStrength = new Int16Array(n);
    for (let y = 0; y < map.h; y++) {
      const row = map.rows[y]!;
      for (let x = 0; x < map.w; x++) {
        const kind = map.legend[row[x]!]!;
        const t = TERRAIN_CODE[kind];
        this.terrain[y * map.w + x] = t;
        this.staticBlocked[y * map.w + x] = t === T_WALL ? 1 : 0;
      }
    }
    for (const f of map.flows) {
      const len = isqrt(f.dir[0] * f.dir[0] * 65536 + f.dir[1] * f.dir[1] * 65536);
      const fx = len ? Math.trunc((f.dir[0] * 65536) / len) : 0;
      const fy = len ? Math.trunc((f.dir[1] * 65536) / len) : 0;
      const [rx, ry, rw, rh] = f.rect;
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          if (!this.inBounds(x, y)) continue;
          const i = y * this.w + x;
          this.flowX[i] = fx;
          this.flowY[i] = fy;
          this.flowStrength[i] = f.strength;
        }
      }
    }
    this.recomputeClearance(0, 0, this.w - 1, this.h - 1);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  blocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const i = y * this.w + x;
    return this.staticBlocked[i] === 1 || this.occupied[i]! > 0;
  }

  /** Can a body of `size` tiles stand with its top-left tile at (x, y)? */
  passable(x: number, y: number, size: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return this.clearance[y * this.w + x]! >= size;
  }

  private recomputeClearance(x0: number, y0: number, x1: number, y1: number): void {
    // clearance depends on tiles to the right and below, so sweep from the bottom-right corner
    for (let y = Math.min(y1, this.h - 1); y >= Math.max(0, y0); y--) {
      for (let x = Math.min(x1, this.w - 1); x >= Math.max(0, x0); x--) {
        const i = y * this.w + x;
        if (this.blocked(x, y)) {
          this.clearance[i] = 0;
          continue;
        }
        const r = x + 1 < this.w ? this.clearance[i + 1]! : 0;
        const d = y + 1 < this.h ? this.clearance[i + this.w]! : 0;
        const rd = x + 1 < this.w && y + 1 < this.h ? this.clearance[i + this.w + 1]! : 0;
        this.clearance[i] = Math.min(MAX_CLEARANCE, 1 + Math.min(r, d, rd));
      }
    }
  }

  /** Stamps (+1) or lifts (-1) a building footprint, given its top-left tile. */
  stampFootprint(tx: number, ty: number, fw: number, fh: number, delta: 1 | -1): void {
    for (let y = ty; y < ty + fh; y++) {
      for (let x = tx; x < tx + fw; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = y * this.w + x;
        this.occupied[i] = Math.max(0, this.occupied[i]! + delta);
      }
    }
    // clearance of tiles up to MAX_CLEARANCE to the left/above can change
    this.recomputeClearance(tx - MAX_CLEARANCE, ty - MAX_CLEARANCE, tx + fw, ty + fh);
    this.version++;
  }

  /**
   * Speed multiplier in thousandths for moving in direction (dx, dy) on tile i:
   * 1000 + strength × cos(angle to the current), clamped to [500, 2000].
   */
  flowFactor(i: number, dx: number, dy: number): number {
    const s = this.flowStrength[i]!;
    if (s === 0 || (dx === 0 && dy === 0)) return 1000;
    const len = isqrt(dx * dx + dy * dy);
    const cos = Math.trunc((dx * this.flowX[i]! + dy * this.flowY[i]!) / len); // −256..256
    const f = 1000 + Math.trunc((s * cos) / 256);
    return f < 500 ? 500 : f > 2000 ? 2000 : f;
  }

  /** Tile index under a world position (sub-tiles). */
  tileAt(x: number, y: number): number {
    const tx = Math.floor(x / SUB);
    const ty = Math.floor(y / SUB);
    return ty * this.w + tx;
  }
}

/** Top-left node tile for a body of `size` whose centre is at (x, y). */
export function nodeOf(x: number, y: number, size: number): [number, number] {
  return [Math.floor((x - size * 128 + 128) / SUB), Math.floor((y - size * 128 + 128) / SUB)];
}

/** Centre (sub-tiles) of a body of `size` standing on node (tx, ty). */
export function centreOf(tx: number, ty: number, size: number): [number, number] {
  return [tx * SUB + size * 128, ty * SUB + size * 128];
}

export function validateMap(m: MapDef): string[] {
  const e: string[] = [];
  if (!Number.isInteger(m.w) || !Number.isInteger(m.h) || m.w < 8 || m.h < 8 || m.w > 256 || m.h > 256) e.push(`map ${m.id}: size ${m.w}x${m.h}`);
  if (m.rows.length !== m.h) e.push(`map ${m.id}: ${m.rows.length} rows, expected ${m.h}`);
  m.rows.forEach((r, y) => {
    if (r.length !== m.w) e.push(`map ${m.id}: row ${y} has ${r.length} columns, expected ${m.w}`);
    for (const ch of r) if (!(ch in m.legend)) e.push(`map ${m.id}: row ${y} uses '${ch}', not in the legend`);
  });
  for (const f of m.flows) {
    const [x, y, w, h] = f.rect;
    if (x < 0 || y < 0 || x + w > m.w || y + h > m.h) e.push(`map ${m.id}: flow rect outside the map`);
    if (!Number.isInteger(f.strength) || f.strength < 0 || f.strength > 1000) e.push(`map ${m.id}: flow strength ${f.strength}`);
  }
  if (e.length === 0) {
    const nav = new NavGrid(m);
    m.starts.forEach(([sx, sy], k) => {
      for (let y = sy; y < sy + 6; y++)
        for (let x = sx; x < sx + 6; x++) if (nav.blocked(x, y)) e.push(`map ${m.id}: start ${k} needs open 6x6 tiles at (${sx}, ${sy}); (${x}, ${y}) is blocked`);
    });
  }
  return e;
}
