// Combat (phases 8 and 9): choosing targets, winding up, launching, and resolving hits.
//
// An attack has four separate stages: a target is chosen, the attacker winds up, the attack
// launches (the cooldown starts here), and it lands (melee and arc on the launch tick,
// projectiles after their flight). Damage is decided here, never by an animation.
// A unit stops to attack. Moving away mid-windup cancels that attack without a shot and
// without touching the cooldown. Every loop runs in id order.

import type { RejectReason } from '../commands/commands';
import { footprintOrigin, type SimContext } from '../context';
import { isqrt, SUB } from '../core/fixed';
import { entityById, type Entity, type World } from '../core/world';
import type { Tag, WeaponDef } from '../content/types';
import { T_WALL } from '../navigation/grid';
import { clearMove, travelTo } from '../navigation/movement';
import { allied, canSee } from '../vision/vision';

/** An idle unit chases this far from where its fight began, then goes back. */
export const LEASH = 8 * SUB;
/** A unit keeps its target while it stays within acquisition range plus this. */
const KEEP_SLACK = 2 * SUB;
/** Units without a target look for one every this many ticks (staggered by id). */
const SCAN_EVERY = 4;
/** A chasing unit asks for a fresh path at most this often, when its target has moved. */
const CHASE_REPATH = 10;
/** Digesting after an engulf takes this many cooldowns. */
const DIGEST = 3;
const CELL = 4 * SUB;

export type CombatEvent =
  | { type: 'launched'; entity: number; target: number; weapon: string; impact: number }
  | { type: 'hit'; entity: number; target: number; weapon: string; amount: number; x: number; y: number }
  | { type: 'engulfed'; entity: number; target: number };

// ---------------------------------------------------------------- what things are

export function weaponOf(ctx: SimContext, e: Entity): WeaponDef | null {
  const id = e.building ? ctx.catalog.buildings.get(e.type)?.weapon : ctx.catalog.units.get(e.type)?.weapon;
  return id ? (ctx.catalog.weapons.get(id) ?? null) : null;
}

function tagsOf(ctx: SimContext, e: Entity): Tag[] {
  if (e.building) return ['building', 'structure'];
  return ctx.catalog.units.get(e.type)?.tags ?? [];
}

function armorOf(ctx: SimContext, e: Entity): number {
  return (e.building ? ctx.catalog.buildings.get(e.type)?.armor : ctx.catalog.units.get(e.type)?.armor) ?? 0;
}

function radiusOf(ctx: SimContext, e: Entity): number {
  return e.building ? 0 : (ctx.catalog.units.get(e.type)?.radius ?? 115);
}

/** Something a player could fight: a living unit or building of another side (not a resource). */
function isFoe(world: World, ctx: SimContext, owner: number, t: Entity): boolean {
  return t.hp > 0 && t.owner !== 0 && !allied(world, owner, t.owner) && !ctx.catalog.resources.has(t.type);
}

/** Distance between two bodies' edges (a building's edge is its footprint). */
export function gap(ctx: SimContext, a: Entity, b: Entity): number {
  if (!a.building && !b.building) return Math.max(0, isqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) - radiusOf(ctx, a) - radiusOf(ctx, b));
  if (a.building && b.building) {
    const [ax, ay, aw, ah] = footprintOrigin(ctx, a.type, a.x, a.y);
    const [bx, by, bw, bh] = footprintOrigin(ctx, b.type, b.x, b.y);
    const dx = Math.max(0, bx - (ax + aw), ax - (bx + bw)) * SUB;
    const dy = Math.max(0, by - (ay + ah), ay - (by + bh)) * SUB;
    return isqrt(dx * dx + dy * dy);
  }
  const [u, bld] = a.building ? [b, a] : [a, b];
  const [tx, ty, fw, fh] = footprintOrigin(ctx, bld.type, bld.x, bld.y);
  const x0 = tx * SUB;
  const y0 = ty * SUB;
  const x1 = (tx + fw) * SUB - 1;
  const y1 = (ty + fh) * SUB - 1;
  const dx = u.x < x0 ? x0 - u.x : u.x > x1 ? u.x - x1 : 0;
  const dy = u.y < y0 ? y0 - u.y : u.y > y1 ? u.y - y1 : 0;
  return Math.max(0, isqrt(dx * dx + dy * dy) - radiusOf(ctx, u));
}

/** Distance from a point to an entity's body edge (a building's edge is its footprint). */
function pointGap(ctx: SimContext, o: Entity, x: number, y: number): number {
  if (!o.building) return Math.max(0, isqrt((o.x - x) ** 2 + (o.y - y) ** 2) - radiusOf(ctx, o));
  const [tx, ty, fw, fh] = footprintOrigin(ctx, o.type, o.x, o.y);
  const dx = x < tx * SUB ? tx * SUB - x : x > (tx + fw) * SUB - 1 ? x - ((tx + fw) * SUB - 1) : 0;
  const dy = y < ty * SUB ? ty * SUB - y : y > (ty + fh) * SUB - 1 ? y - ((ty + fh) * SUB - 1) : 0;
  return isqrt(dx * dx + dy * dy);
}

/** No membrane between them (buildings and bodies do not block a shot; walls do). */
function lineOfFire(ctx: SimContext, a: Entity, b: Entity): boolean {
  const nav = ctx.nav;
  let x = Math.floor(a.x / SUB);
  let y = Math.floor(a.y / SUB);
  const x1 = Math.floor(b.x / SUB);
  const y1 = Math.floor(b.y / SUB);
  const dx = Math.abs(x1 - x);
  const dy = -Math.abs(y1 - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (nav.terrain[y * nav.w + x] === T_WALL) return false;
    if (x === x1 && y === y1) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function inRange(ctx: SimContext, a: Entity, t: Entity, w: WeaponDef): boolean {
  const g = gap(ctx, a, t);
  if (g > w.range || (w.minRange > 0 && g < w.minRange)) return false;
  return w.range <= SUB + SUB / 2 || lineOfFire(ctx, a, t);
}

// ---------------------------------------------------------------- choosing targets

/** Units near things, rebuilt each phase: cells of 4x4 tiles. */
class Spatial {
  private readonly cells = new Map<number, Entity[]>();
  private readonly cw: number;
  constructor(world: World) {
    this.cw = Math.ceil(world.mapW / CELL) + 1;
    for (const e of world.entities) {
      if (e.hp <= 0 || e.owner === 0) continue;
      const k = Math.floor(e.y / CELL) * this.cw + Math.floor(e.x / CELL);
      const list = this.cells.get(k);
      if (list) list.push(e);
      else this.cells.set(k, [e]);
    }
  }
  /** Everything whose centre lies within `r` (plus a building's half size) of (x, y), in a fixed order. */
  near(x: number, y: number, r: number): Entity[] {
    const pad = 3 * SUB;
    const c0x = Math.floor((x - r - pad) / CELL);
    const c1x = Math.floor((x + r + pad) / CELL);
    const c0y = Math.floor((y - r - pad) / CELL);
    const c1y = Math.floor((y + r + pad) / CELL);
    const out: Entity[] = [];
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) for (const e of this.cells.get(cy * this.cw + cx) ?? []) out.push(e);
    return out;
  }
}

/** Fighters first, then other units, then armed buildings, then the rest. */
function priority(ctx: SimContext, t: Entity): number {
  const armed = weaponOf(ctx, t) !== null;
  if (!t.building) return armed ? 0 : 1;
  return armed ? 2 : 3;
}

function acquire(world: World, ctx: SimContext, grid: Spatial, e: Entity, range: number): Entity | null {
  let best: Entity | null = null;
  let bp = 0;
  let bd = 0;
  for (const t of grid.near(e.x, e.y, range)) {
    if (!isFoe(world, ctx, e.owner, t) || !canSee(ctx, e.owner, t)) continue;
    const d = gap(ctx, e, t);
    if (d > range) continue;
    const p = priority(ctx, t);
    if (!best || p < bp || (p === bp && (d < bd || (d === bd && t.id < best.id)))) {
      best = t;
      bp = p;
      bd = d;
    }
  }
  return best;
}

function sightOf(ctx: SimContext, e: Entity): number {
  return (e.building ? ctx.catalog.buildings.get(e.type)?.sight : ctx.catalog.units.get(e.type)?.sight) ?? 0;
}

// ---------------------------------------------------------------- orders

export function validateAttack(world: World, ctx: SimContext, player: number, units: Entity[], target: Entity | undefined): RejectReason | null {
  if (!units.some((u) => u.cb !== null)) return 'no_weapons';
  if (!target || target.hp <= 0) return 'unknown_target';
  if (!isFoe(world, ctx, player, target)) return 'bad_target';
  // the same answer whether the target is gone or only out of sight: nothing hidden leaks
  if (!canSee(ctx, player, target)) return 'unknown_target';
  return null;
}

/** Drops whatever attack a unit was winding up (no shot; the cooldown stays as it was). */
export function stopAttack(e: Entity): void {
  if (!e.cb) return;
  e.cb.target = 0;
  e.cb.windupEnd = -1;
  e.cb.engaged = false;
}

// ---------------------------------------------------------------- phase 8

function chase(world: World, ctx: SimContext, e: Entity, t: Entity): void {
  const cb = e.cb!;
  const gx = t.x;
  const gy = t.y;
  const drift = e.mv ? isqrt((e.mv.gx - gx) ** 2 + (e.mv.gy - gy) ** 2) : Infinity;
  if (e.mv && (drift <= SUB || world.tick - cb.chased < CHASE_REPATH)) return;
  cb.chased = world.tick;
  if (t.building) {
    // the nearest open side of the building
    const [tx, ty, fw, fh] = footprintOrigin(ctx, t.type, t.x, t.y);
    const cx = Math.min(Math.max(e.x, tx * SUB - SUB / 2), (tx + fw) * SUB + SUB / 2);
    const cy = Math.min(Math.max(e.y, ty * SUB - SUB / 2), (ty + fh) * SUB + SUB / 2);
    travelTo(world, ctx, e, cx, cy);
  } else travelTo(world, ctx, e, gx, gy);
}

/** Fight `t`: in range, stop and wind up, then launch; out of range, chase (or wait, holding). */
function engage(world: World, ctx: SimContext, e: Entity, t: Entity, w: WeaponDef, mayChase: boolean, launches: Entity[]): void {
  const cb = e.cb!;
  if (cb.target !== t.id) {
    cb.target = t.id;
    cb.windupEnd = -1;
  }
  if (!inRange(ctx, e, t, w)) {
    cb.windupEnd = -1; // walked or pushed out of range: that attack is off, the cooldown untouched
    if (mayChase && !e.building) chase(world, ctx, e, t);
    return;
  }
  if (e.mv) clearMove(world, e);
  if (cb.windupEnd < 0) {
    if (world.tick < cb.nextLaunch - w.windup) return;
    cb.windupEnd = world.tick + w.windup;
  }
  if (world.tick >= cb.windupEnd) launches.push(e);
}

/** Phase 8: targets, windups and launches. */
export function combatPhase(world: World, ctx: SimContext, events: CombatEvent[]): void {
  const grid = new Spatial(world);
  const tick = world.tick;
  const launches: Entity[] = [];
  for (const e of world.entities) {
    const cb = e.cb;
    if (!cb || e.hp <= 0 || e.build || e.morph) continue;
    const w = weaponOf(ctx, e);
    if (!w) continue;
    const order = e.order;
    // orders that only move, work or turn: no fighting
    if (order.kind === 'move' || order.kind === 'gather' || order.kind === 'job' || order.kind === 'morph') {
      if (cb.target !== 0) stopAttack(e);
      continue;
    }
    const current = cb.target !== 0 ? entityById(world, cb.target) : undefined;
    const sees = (t: Entity | undefined): t is Entity => t !== undefined && isFoe(world, ctx, e.owner, t) && canSee(ctx, e.owner, t);
    if (order.kind === 'attack') {
      const t = entityById(world, order.target);
      if (!sees(t)) {
        // the target died or slipped out of sight: the order is over
        stopAttack(e);
        clearMove(world, e);
        e.order = { kind: 'idle' };
        continue;
      }
      engage(world, ctx, e, t, w, true, launches);
      continue;
    }
    const holding = e.building || order.kind === 'hold';
    const range = holding ? w.range : Math.max(sightOf(ctx, e), w.range);
    let t: Entity | null = sees(current) && gap(ctx, e, current) <= range + (holding ? 0 : KEEP_SLACK) ? current : null;
    if (!t && (cb.target !== 0 || (tick + e.id) % SCAN_EVERY === 0)) t = acquire(world, ctx, grid, e, range);
    if (!t) {
      if (cb.target !== 0) stopAttack(e);
      if (order.kind === 'amove' && !e.mv) {
        // nothing to fight: on to the point, or done there
        if (isqrt((e.x - order.x) ** 2 + (e.y - order.y) ** 2) <= SUB) e.order = { kind: 'idle' };
        else travelTo(world, ctx, e, order.x, order.y);
      }
      continue;
    }
    if (order.kind === 'idle') {
      if (!cb.engaged) {
        cb.engaged = true;
        cb.anchorX = e.x;
        cb.anchorY = e.y;
      } else if (isqrt((e.x - cb.anchorX) ** 2 + (e.y - cb.anchorY) ** 2) > LEASH) {
        // too far from where the fight began: back there, without fighting on the way
        const [ax, ay] = [cb.anchorX, cb.anchorY];
        stopAttack(e);
        e.order = { kind: 'move', x: ax, y: ay };
        travelTo(world, ctx, e, ax, ay);
        continue;
      }
    }
    engage(world, ctx, e, t, w, !holding, launches);
  }
  // launches, in id order: the cooldown starts now; melee and arc land this tick, projectiles later
  for (const e of launches) {
    const cb = e.cb!;
    const w = weaponOf(ctx, e)!;
    const t = entityById(world, cb.target)!;
    const flight = w.speed > 0 ? Math.max(1, Math.ceil(isqrt((e.x - t.x) ** 2 + (e.y - t.y) ** 2) / w.speed)) : 0;
    world.projectiles.push({ id: world.nextShot++, owner: e.owner, weapon: w.id, source: e.id, target: t.id, fromX: e.x, fromY: e.y, x: t.x, y: t.y, launch: tick, impact: tick + flight });
    cb.nextLaunch = tick + w.cooldown;
    cb.windupEnd = -1;
    events.push({ type: 'launched', entity: e.id, target: t.id, weapon: w.id, impact: tick + flight });
  }
}

// ---------------------------------------------------------------- phase 9

/** Damage after the weapon's bonus against the target's tags and the target's armor; never below 1. */
export function damageOf(ctx: SimContext, w: WeaponDef, t: Entity): number {
  let mult = 1000;
  for (const tag of tagsOf(ctx, t)) mult = Math.max(mult, w.bonus[tag] ?? 1000);
  return Math.max(1, Math.floor((w.damage * mult) / 1000) - armorOf(ctx, t));
}

function strike(world: World, ctx: SimContext, w: WeaponDef, source: number, t: Entity, events: CombatEvent[]): void {
  const amount = damageOf(ctx, w, t);
  t.hp -= amount;
  if (w.slow > 0 && !t.building) t.slow = { until: world.tick + w.slowTicks, pct: w.slow };
  events.push({ type: 'hit', entity: source, target: t.id, weapon: w.id, amount, x: t.x, y: t.y });
}

/** Phase 9: everything landing this tick, in launch order; damage only (no healing in the slice yet). */
export function hitPhase(world: World, ctx: SimContext, events: CombatEvent[]): void {
  const tick = world.tick;
  if (world.projectiles.length === 0) return;
  const landing = world.projectiles.filter((p) => p.impact <= tick);
  if (landing.length === 0) return;
  world.projectiles = world.projectiles.filter((p) => p.impact > tick);
  const grid = new Spatial(world);
  for (const p of landing) {
    const w = ctx.catalog.weapons.get(p.weapon)!;
    const t = entityById(world, p.target);
    const alive = t !== undefined && t.hp > 0;
    if (alive) {
      p.x = t.x;
      p.y = t.y;
    } else if (w.onTargetLost === 'fizzle' || w.splash === 0) continue;
    const src = entityById(world, p.source);
    if (w.kind === 'engulf' && alive && !t.building && t.hp <= w.engulfMaxHp && !tagsOf(ctx, t).includes('capsule')) {
      // swallowed whole; the macrophage then digests for a while
      t.hp = 0;
      events.push({ type: 'engulfed', entity: p.source, target: t.id });
      if (src?.cb) src.cb.nextLaunch = Math.max(src.cb.nextLaunch, tick + w.cooldown * DIGEST);
      continue;
    }
    if (w.splash > 0) {
      // everything of the other side within the splash, around where it lands
      for (const o of grid.near(p.x, p.y, w.splash)) {
        if (!isFoe(world, ctx, p.owner, o)) continue;
        if (pointGap(ctx, o, p.x, p.y) <= w.splash) strike(world, ctx, w, p.source, o, events);
      }
      continue;
    }
    if (!alive) continue;
    strike(world, ctx, w, p.source, t, events);
    if (w.kind === 'arc' && src && w.maxTargets > 1) {
      // a sweep: more targets within range, in front of the attacker
      const fx = t.x - src.x;
      const fy = t.y - src.y;
      const fl = Math.max(1, isqrt(fx * fx + fy * fy));
      let more = w.maxTargets - 1;
      for (const o of grid.near(src.x, src.y, w.range)) {
        if (more === 0) break;
        if (o.id === t.id || !isFoe(world, ctx, p.owner, o) || gap(ctx, src, o) > w.range) continue;
        const ox = o.x - src.x;
        const oy = o.y - src.y;
        const ol = Math.max(1, isqrt(ox * ox + oy * oy));
        if (Math.trunc(((fx * ox + fy * oy) * 1000) / (fl * ol)) < w.arcCos) continue;
        strike(world, ctx, w, p.source, o, events);
        more--;
      }
    }
  }
}
