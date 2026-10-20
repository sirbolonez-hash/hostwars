// Biofilm: the Colony's ground (architecture tab, section 4; main tab, section 5).
//
// Each finished biofilm core spreads biofilm around it, from 3 tiles when it is finished to
// 10 tiles a little under half a minute later. Biofilm is derived from the cores standing in
// the world, recomputed at the start of every tick, so it is never saved and a loaded match
// gets exactly the same ground. Where two players' biofilm meets, the older core holds it.
//
// What it does: the Colony builds only on its own biofilm; its units and buildings standing
// on it take a quarter less damage, and its units regain hit points there; antibodies lose
// 60% against what stands on it; immune units walk 20% slower across it.

import type { SimContext } from '../context';
import { SUB } from '../core/fixed';
import type { Entity, World } from '../core/world';
import { T_WALL } from '../navigation/grid';

export const BIOFILM_START = 3;
export const BIOFILM_MAX = 10;
/** Ticks per extra tile of radius while a core spreads. */
export const BIOFILM_GROW = 80;
/** Damage taken on own biofilm, thousandths. */
export const BIOFILM_GUARD = 750;
/** Antibodies against something on biofilm, thousandths. */
export const BIOFILM_VS_ANTIBODY = 400;
/** Immune units on someone else's biofilm, thousandths of their speed. */
export const BIOFILM_DRAG = 800;
/** A unit on own biofilm regains 1 hit point this often. */
export const BIOFILM_REGEN_EVERY = 20;

export class Biofilm {
  /** owner of the biofilm on each tile; 0 = none */
  readonly owner: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.owner = new Uint8Array(w * h);
  }

  at(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 0;
    return this.owner[ty * this.w + tx]!;
  }

  /** The biofilm owner under an entity's centre. */
  under(e: Entity): number {
    return this.at(Math.floor(e.x / SUB), Math.floor(e.y / SUB));
  }
}

/** Does this building type spread biofilm? (The Colony's cores.) */
export function spreads(ctx: SimContext, type: string): boolean {
  const b = ctx.catalog.buildings.get(type);
  return b !== undefined && b.role === 'hq' && b.placement === 'anywhere';
}

/** The radius (tiles) a finished core has spread to at `tick`. */
export function biofilmRadius(e: Entity, tick: number): number {
  if (e.build) return 0;
  return Math.min(BIOFILM_MAX, BIOFILM_START + Math.floor(Math.max(0, tick - e.doneTick) / BIOFILM_GROW));
}

/** Phase 2: lays the biofilm from every standing core, oldest first. */
export function computeBiofilm(world: World, ctx: SimContext): void {
  const bf = ctx.biofilm;
  bf.owner.fill(0);
  const nav = ctx.nav;
  for (const e of world.entities) {
    if (!e.building || e.hp <= 0 || e.owner === 0 || !spreads(ctx, e.type)) continue;
    const r = biofilmRadius(e, world.tick);
    if (r <= 0) continue;
    const cx = Math.floor(e.x / SUB);
    const cy = Math.floor(e.y / SUB);
    for (let y = Math.max(0, cy - r); y <= Math.min(bf.h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(bf.w - 1, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r * r + r) continue;
        const i = y * bf.w + x;
        if (bf.owner[i] !== 0 || nav.terrain[i] === T_WALL) continue;
        bf.owner[i] = e.owner;
      }
    }
  }
}
