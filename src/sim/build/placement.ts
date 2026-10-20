// Where a building may stand. The same check serves the simulation (at the tick the order
// runs) and the client's green/red preview; the preview passes `canSee`, so it never
// reacts to an enemy the player cannot see (the simulation then refuses with a reason that
// says nothing about what is hidden).

import { footprintOrigin, type SimContext } from '../context';
import { SUB } from '../core/fixed';
import type { Entity, World } from '../core/world';
import { T_OPEN, T_WALL } from '../navigation/grid';

/** Within this many tiles of one of the player's buildings (edge to edge). */
export const NEAR_TILES = 8;
/** A builder placing an expansion stands within this many tiles of its footprint. */
export const BUILDER_TILES = 2;

export type PlaceReason = 'out_of_bounds' | 'bad_ground' | 'site_blocked' | 'too_far' | 'no_builder' | 'blocks_exit' | 'no_deposit' | 'cannot_place';

export type PlaceCheck = { ok: true; deposit: number; friendlies: number[] } | { ok: false; reason: PlaceReason };

/** Gap in tiles between two tile rectangles (0 when they touch or overlap). */
export function rectGap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): number {
  const dx = Math.max(0, bx - (ax + aw), ax - (bx + bw));
  const dy = Math.max(0, by - (ay + ah), ay - (by + bh));
  return Math.max(dx, dy);
}

/** The tile a production building sends new units to: below the middle of its footprint. */
export function exitTile(ctx: SimContext, b: Entity): [number, number] {
  const [tx, ty, fw, fh] = footprintOrigin(ctx, b.type, b.x, b.y);
  return [tx + Math.floor(fw / 2), ty + fh];
}

function exitOf(type: string, tx: number, ty: number, fw: number, fh: number): [number, number] {
  void type;
  return [tx + Math.floor(fw / 2), ty + fh];
}

/**
 * Can `player` place `type` with its top-left tile at (tx, ty)? `canSee` limits which
 * units count (the preview passes the player's vision; the simulation passes nothing).
 */
export function checkPlacement(world: World, ctx: SimContext, player: number, type: string, tx: number, ty: number, canSee?: (e: Entity) => boolean): PlaceCheck {
  const { catalog, nav } = ctx;
  const def = catalog.buildings.get(type);
  if (!def || def.placement === 'none' || def.placement === 'biofilm') return { ok: false, reason: 'cannot_place' };
  const [fw, fh] = def.footprint;
  if (tx < 0 || ty < 0 || tx + fw > nav.w || ty + fh > nav.h) return { ok: false, reason: 'out_of_bounds' };

  let deposit = 0;
  if (def.placement === 'resource') {
    // an extractor goes exactly on a free deposit of its kind
    for (const e of world.entities) {
      if (!e.res || catalog.resources.get(e.type)?.kind !== def.onResource || e.res.link !== 0 || e.res.stock <= 0) continue;
      const [ox, oy] = footprintOrigin(ctx, e.type, e.x, e.y);
      if (ox === tx && oy === ty) deposit = e.id;
    }
    if (deposit === 0) return { ok: false, reason: 'no_deposit' };
  } else {
    for (let y = ty; y < ty + fh; y++) {
      for (let x = tx; x < tx + fw; x++) {
        const i = y * nav.w + x;
        if (nav.terrain[i] !== T_OPEN) return { ok: false, reason: 'bad_ground' };
        if (nav.blocked(x, y)) return { ok: false, reason: 'site_blocked' };
      }
    }
  }

  // nobody's production exit may end up under it, and its own exit must be open ground
  for (const b of world.entities) {
    if (!b.building || !b.queue) continue;
    const [ex, ey] = exitTile(ctx, b);
    if (ex >= tx && ex < tx + fw && ey >= ty && ey < ty + fh) return { ok: false, reason: 'blocks_exit' };
  }
  if (def.produces.length > 0) {
    const [ex, ey] = exitOf(type, tx, ty, fw, fh);
    if (!nav.inBounds(ex, ey) || nav.terrain[ey * nav.w + ex] === T_WALL || nav.blocked(ex, ey)) return { ok: false, reason: 'blocks_exit' };
  }

  // units on the site: an enemy refuses it; friendly units are moved off when it is placed
  const friendlies: number[] = [];
  for (const u of world.entities) {
    if (u.building || u.hp <= 0) continue;
    const ux = Math.floor(u.x / SUB);
    const uy = Math.floor(u.y / SUB);
    if (ux < tx || ux >= tx + fw || uy < ty || uy >= ty + fh) continue;
    if (u.owner === player) friendlies.push(u.id);
    else if (!canSee || canSee(u)) return { ok: false, reason: 'site_blocked' };
  }

  if (def.placement === 'near') {
    let near = false;
    for (const b of world.entities) {
      if (!b.building || b.owner !== player || b.hp <= 0 || catalog.resources.has(b.type)) continue;
      const [bx, by, bw, bh] = footprintOrigin(ctx, b.type, b.x, b.y);
      if (rectGap(tx, ty, fw, fh, bx, by, bw, bh) <= NEAR_TILES) {
        near = true;
        break;
      }
    }
    if (!near) return { ok: false, reason: 'too_far' };
  }
  if (def.placement === 'builder') {
    const ok = world.entities.some((u) => {
      if (u.building || u.owner !== player || u.hp <= 0 || catalog.units.get(u.type)?.role !== 'builder') return false;
      return rectGap(tx, ty, fw, fh, Math.floor(u.x / SUB), Math.floor(u.y / SUB), 1, 1) <= BUILDER_TILES;
    });
    if (!ok) return { ok: false, reason: 'no_builder' };
  }
  return { ok: true, deposit, friendlies };
}
