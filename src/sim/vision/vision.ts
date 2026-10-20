// Vision (phases 2 and 6): which tiles each player sees this tick, which they have explored,
// and what they remember of buildings and resources they no longer see.
//
// A tile is unexplored, explored-hidden or visible, per player (architecture tab, section 6).
// Allies share sight. Sight is a circle around each unit and building; walls do not block it
// in the slice. What is visible is derived from the world and recomputed every tick, so it is
// never saved; what was explored, and the memory of buildings, are world state.

import type { SimContext } from '../context';
import { footprintOrigin } from '../context';
import { SUB } from '../core/fixed';
import { entityById, type Entity, type World } from '../core/world';

const discs = new Map<number, Int16Array>();

/** Offsets [dx0, dy0, dx1, dy1, …] of the tiles within `r` tiles of a centre tile. */
function disc(r: number): Int16Array {
  let d = discs.get(r);
  if (d) return d;
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) out.push(dx, dy);
  d = Int16Array.from(out);
  discs.set(r, d);
  return d;
}

export class Vision {
  /** per player index: 1 where the player (or an ally) sees this tick */
  readonly visible: Uint8Array[] = [];
  /** the tick the arrays describe; -1 = never computed */
  tick = -1;
  /** the grids themselves, one per team, reused */
  readonly teamGrids = new Map<number, Uint8Array>();
  constructor(readonly w: number, readonly h: number) {}

  sees(player: number, tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return false;
    return (this.visible[player - 1]?.[ty * this.w + tx] ?? 0) === 1;
  }
}

/** Sight of an entity in whole tiles (0 for resources). */
function sightOf(ctx: SimContext, e: Entity): number {
  const d = e.building ? ctx.catalog.buildings.get(e.type) : ctx.catalog.units.get(e.type);
  return d ? Math.round(d.sight / SUB) : 0;
}

export function exploredBit(world: World, player: number, i: number): boolean {
  const words = world.explored[player - 1];
  return words !== undefined && ((words[i >> 5]! >>> (i & 31)) & 1) === 1;
}

/** Can `player` see `e` this tick? A building or resource counts as seen when any tile of it is. */
export function canSee(ctx: SimContext, player: number, e: Entity): boolean {
  const v = ctx.vision;
  if (!e.building) return v.sees(player, Math.floor(e.x / SUB), Math.floor(e.y / SUB));
  const [tx, ty, fw, fh] = footprintOrigin(ctx, e.type, e.x, e.y);
  for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) if (v.sees(player, x, y)) return true;
  return false;
}

/** Same side? Allies (same team) count as one side; neutral is nobody's side. */
export function allied(world: World, a: number, b: number): boolean {
  if (a === 0 || b === 0) return a === b;
  return world.players[a - 1]!.team === world.players[b - 1]!.team;
}

/**
 * Recomputes what everyone sees from where everything stands now. With `remember`, also marks
 * explored tiles and updates each player's memory of buildings and resources (phase 6).
 */
export function computeVision(world: World, ctx: SimContext, remember: boolean): void {
  const v = ctx.vision;
  const n = v.w * v.h;
  // one grid per team, reused from tick to tick
  const teams = v.teamGrids;
  for (const p of world.players) {
    let g = teams.get(p.team);
    if (!g) {
      g = new Uint8Array(n);
      teams.set(p.team, g);
    }
  }
  for (const g of teams.values()) g.fill(0);
  for (const e of world.entities) {
    if (e.owner === 0 || e.hp <= 0) continue;
    const r = sightOf(ctx, e);
    if (r <= 0) continue;
    const grid = teams.get(world.players[e.owner - 1]!.team)!;
    const cx = Math.floor(e.x / SUB);
    const cy = Math.floor(e.y / SUB);
    const d = disc(r);
    if (cx - r >= 0 && cy - r >= 0 && cx + r < v.w && cy + r < v.h) {
      const base = cy * v.w + cx;
      for (let k = 0; k < d.length; k += 2) grid[base + d[k + 1]! * v.w + d[k]!] = 1;
    } else {
      for (let k = 0; k < d.length; k += 2) {
        const x = cx + d[k]!;
        const y = cy + d[k + 1]!;
        if (x >= 0 && y >= 0 && x < v.w && y < v.h) grid[y * v.w + x] = 1;
      }
    }
  }
  world.players.forEach((p, i) => (v.visible[i] = teams.get(p.team)!));
  v.tick = world.tick;
  if (!remember) return;

  for (const p of world.players) {
    const vis = v.visible[p.id - 1]!;
    const words = world.explored[p.id - 1]!;
    for (let i = 0; i < n; i += 32) {
      let bits = 0;
      const end = Math.min(32, n - i);
      for (let b = 0; b < end; b++) if (vis[i + b]) bits |= 1 << b;
      if (bits) words[i >> 5] = (words[i >> 5]! | bits) >>> 0;
    }
    // memory: what is seen now is refreshed in place; what was remembered on a tile seen now,
    // and is gone, is forgotten
    const mem = world.memory[p.id - 1]!;
    const at = new Map<number, number>();
    mem.forEach((m, k) => at.set(m.id, k));
    let added = false;
    for (const e of world.entities) {
      if (!e.building || e.hp <= 0 || (e.owner !== 0 && allied(world, e.owner, p.id))) continue;
      if (!canSee(ctx, p.id, e)) continue;
      const k = at.get(e.id);
      const m = k === undefined ? undefined : mem[k];
      if (m) {
        m.type = e.type;
        m.x = e.x;
        m.y = e.y;
        m.hp = e.hp;
        m.maxHp = e.maxHp;
        m.growing = e.build !== null;
        m.stock = e.res?.stock ?? 0;
        m.tick = world.tick;
      } else {
        mem.push({ id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, growing: e.build !== null, stock: e.res?.stock ?? 0, tick: world.tick });
        added = true;
      }
    }
    if (added) mem.sort((a, b) => a.id - b.id);
    let gone = false;
    for (const m of mem) if (!entityById(world, m.id) && v.sees(p.id, Math.floor(m.x / SUB), Math.floor(m.y / SUB))) gone = true;
    if (gone) world.memory[p.id - 1] = mem.filter((m) => entityById(world, m.id) || !v.sees(p.id, Math.floor(m.x / SUB), Math.floor(m.y / SUB)));
  }
}
