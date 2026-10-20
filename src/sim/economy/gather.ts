// Gathering (phase 7 of the tick): carriers work crystals and extractors and carry each load
// to a dropoff. Money appears only at unload, in one action. A load on the way is not money,
// and it is lost if the carrier dies.
//
// Every reservation is a work slot on a crystal or an extractor. A slot has exactly one
// living owner, who is harvesting there; it is released when the harvest ends, when the
// carrier gets another order, or when the carrier dies (removeEntity).
//
// Every loop runs in entity-id order, so two carriers that finish on the same tick take
// from the stock in a fixed order and never more than is left.

import type { RejectReason } from '../commands/commands';
import { footprintOrigin, type SimContext } from '../context';
import { isqrt, SUB } from '../core/fixed';
import { entityById, NEUTRAL, type Entity, type GatherState, type World } from '../core/world';
import type { ResourceKind } from '../content/types';
import { clearMove, travelTo } from '../navigation/movement';

/** Ticks to hand over a load at a dropoff. */
export const UNLOAD_TICKS = 20;
/** A carrier works a target once its centre is this close to the target's footprint, plus its own radius. */
export const REACH_PAD = 96;
/** On a taken slot, a carrier moves to a free crystal of the same field this close to its own. */
const BOUNCE_RANGE = 5 * SUB;
/** When a field runs out, carriers look this far for any other crystal. */
const NEARBY_RANGE = 12 * SUB;
/** Failed approaches before trying another target; twice this, and the carrier gives up. */
const MAX_TRIES = 3;
/** A waiting carrier looks for a free crystal next to its own this often. */
const WAIT_RECHECK = 20;
/** The approach spots around a target that carriers spread over (closest to the dropoff first). */
const APPROACH_SPOTS = 3;

export type GatherStopReason = 'depleted' | 'no_dropoff' | 'path_blocked' | 'no_extractor';

export type GatherEvent =
  | { type: 'delivered'; entity: number; owner: number; kind: ResourceKind; amount: number; dropoff: number }
  | { type: 'gather_stopped'; entity: number; reason: GatherStopReason };

// ---------------------------------------------------------------- what things are

export function carryOf(ctx: SimContext, e: Entity): number {
  return e.building ? 0 : (ctx.catalog.units.get(e.type)?.carry ?? 0);
}

export function isCrystal(ctx: SimContext, e: Entity): boolean {
  return (ctx.catalog.resources.get(e.type)?.slots ?? 0) > 0;
}

export function isDeposit(ctx: SimContext, e: Entity): boolean {
  const r = ctx.catalog.resources.get(e.type);
  return r !== undefined && r.slots === 0;
}

export function isExtractor(ctx: SimContext, e: Entity): boolean {
  return ctx.catalog.buildings.get(e.type)?.role === 'extractor';
}

export function isDropoffOf(ctx: SimContext, e: Entity, owner: number): boolean {
  return e.owner === owner && e.hp > 0 && ctx.catalog.buildings.get(e.type)?.dropoff === true;
}

const alive = (e: Entity | undefined): e is Entity => e !== undefined && e.hp > 0;

/** Where the stock of a target lives: the crystal itself, or the deposit under an extractor. */
function sourceOf(world: World, ctx: SimContext, t: Entity): Entity | undefined {
  if (!t.res) return undefined;
  if (isCrystal(ctx, t)) return t;
  if (isExtractor(ctx, t) && t.res.link !== 0) return entityById(world, t.res.link);
  return undefined;
}

/** Can `owner`'s carriers work `t` right now? */
export function workable(world: World, ctx: SimContext, t: Entity | undefined, owner: number): t is Entity {
  if (!alive(t) || !t.res) return false;
  if (t.owner !== NEUTRAL && t.owner !== owner) return false;
  const src = sourceOf(world, ctx, t);
  return alive(src) && src.res !== null && src.res.stock > 0;
}

function kindOf(world: World, ctx: SimContext, t: Entity): ResourceKind {
  const src = sourceOf(world, ctx, t);
  return ctx.catalog.resources.get(src?.type ?? '')?.kind ?? 'glucose';
}

// ---------------------------------------------------------------- geometry

function radius(ctx: SimContext, e: Entity): number {
  return ctx.catalog.units.get(e.type)?.radius ?? 115;
}

/** Distance from a unit's centre to the nearest point of a footprint. */
export function edgeDist(ctx: SimContext, e: Entity, t: Entity): number {
  const [tx, ty, fw, fh] = footprintOrigin(ctx, t.type, t.x, t.y);
  const x0 = tx * SUB;
  const y0 = ty * SUB;
  const x1 = (tx + fw) * SUB - 1;
  const y1 = (ty + fh) * SUB - 1;
  const dx = e.x < x0 ? x0 - e.x : e.x > x1 ? e.x - x1 : 0;
  const dy = e.y < y0 ? y0 - e.y : e.y > y1 ? e.y - y1 : 0;
  return isqrt(dx * dx + dy * dy);
}

export function inReach(ctx: SimContext, e: Entity, t: Entity): boolean {
  return edgeDist(ctx, e, t) <= radius(ctx, e) + REACH_PAD;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
}

/**
 * A spot next to `t` to walk to: the open tiles around its footprint, closest to `toward`
 * first; `rank` spreads carriers of one target over the best few. Null if it is walled in.
 */
function approachSpot(ctx: SimContext, t: Entity, toward: [number, number], rank: number): [number, number] | null {
  const [tx, ty, fw, fh] = footprintOrigin(ctx, t.type, t.x, t.y);
  const spots: [number, number, number][] = [];
  for (let y = ty - 1; y <= ty + fh; y++) {
    for (let x = tx - 1; x <= tx + fw; x++) {
      const border = x === tx - 1 || x === tx + fw || y === ty - 1 || y === ty + fh;
      if (!border || !ctx.nav.passable(x, y, 1)) continue;
      const cx = x * SUB + SUB / 2;
      const cy = y * SUB + SUB / 2;
      spots.push([cx, cy, dist2(cx, cy, toward[0], toward[1])]);
    }
  }
  if (spots.length === 0) return null;
  // stable: equal distances keep row-major order
  spots.sort((a, b) => a[2] - b[2]);
  const s = spots[rank % Math.min(APPROACH_SPOTS, spots.length)]!;
  return [s[0], s[1]];
}

// ---------------------------------------------------------------- choices

/** How many carriers work (or head for) each target. */
export function countAssigned(world: World): Map<number, number> {
  const m = new Map<number, number>();
  for (const e of world.entities) if (e.gather && e.gather.target !== 0 && e.hp > 0) m.set(e.gather.target, (m.get(e.gather.target) ?? 0) + 1);
  return m;
}

function nearestDropoff(world: World, ctx: SimContext, e: Entity, exclude = 0): Entity | null {
  let best: Entity | null = null;
  let bestD = 0;
  for (const b of world.entities) {
    if (!b.building || b.id === exclude || !isDropoffOf(ctx, b, e.owner)) continue;
    const d = edgeDist(ctx, e, b);
    if (!best || d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/**
 * A crystal for a carrier: the least worked one in `field` (ties to the one nearest (nx, ny)),
 * or, when the field has none left, the least worked crystal near (nx, ny).
 */
function pickCrystal(world: World, ctx: SimContext, e: Entity, field: number, nx: number, ny: number, assigned: Map<number, number>, exclude: number): Entity | null {
  const pick = (inField: boolean): Entity | null => {
    let best: Entity | null = null;
    let bestN = 0;
    let bestD = 0;
    for (const c of world.entities) {
      if (!c.res || c.id === exclude || !isCrystal(ctx, c) || !workable(world, ctx, c, e.owner)) continue;
      const d = dist2(c.x, c.y, nx, ny);
      if (inField ? c.res.field !== field : d > NEARBY_RANGE * NEARBY_RANGE) continue;
      const n = (assigned.get(c.id) ?? 0) - (e.gather?.target === c.id ? 1 : 0);
      if (!best || n < bestN || (n === bestN && d < bestD)) {
        best = c;
        bestN = n;
        bestD = d;
      }
    }
    return best;
  };
  return (field !== 0 ? pick(true) : null) ?? pick(false);
}

/** A free crystal right next to the carrier's one, that nobody else is heading for. */
function bounceCrystal(world: World, ctx: SimContext, e: Entity, g: GatherState, assigned: Map<number, number>): Entity | null {
  if (g.field === 0) return null;
  let best: Entity | null = null;
  let bestD = 0;
  for (const c of world.entities) {
    if (!c.res || c.id === g.target || c.res.field !== g.field || !isCrystal(ctx, c) || !workable(world, ctx, c, e.owner)) continue;
    if ((assigned.get(c.id) ?? 0) > 0 || !c.res.slots.includes(0)) continue;
    if (dist2(c.x, c.y, g.tx, g.ty) > BOUNCE_RANGE * BOUNCE_RANGE) continue;
    const d = dist2(c.x, c.y, e.x, e.y);
    if (!best || d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------- slots

function reserve(t: Entity, id: number): boolean {
  const slots = t.res!.slots;
  const k = slots.indexOf(0);
  if (k < 0) return false;
  slots[k] = id;
  return true;
}

/** Frees any slot the carrier holds. */
export function releaseSlot(world: World, e: Entity): void {
  for (const o of world.entities) {
    if (!o.res) continue;
    const k = o.res.slots.indexOf(e.id);
    if (k >= 0) o.res.slots[k] = 0;
  }
}

/** Ends a carrier's gather order without a report: it got another order. Keeps its load. */
export function stopGather(world: World, e: Entity): void {
  if (!e.gather) return;
  releaseSlot(world, e);
  e.gather = null;
  if (e.order.kind === 'gather') e.order = { kind: 'idle' };
}

// ---------------------------------------------------------------- the order

/** Can `player` send carriers to `target`? (The units were checked already.) */
export function validateGather(world: World, ctx: SimContext, player: number, target: Entity | undefined): RejectReason | null {
  if (!alive(target)) return 'unknown_target';
  if (target.owner === player && isDropoffOf(ctx, target, player)) return null;
  if (target.owner !== NEUTRAL && target.owner !== player) return 'not_owner';
  if (isCrystal(ctx, target)) return target.res!.stock > 0 ? null : 'depleted';
  let ext: Entity | undefined = target;
  if (isDeposit(ctx, target)) {
    ext = target.res!.link !== 0 ? entityById(world, target.res!.link) : undefined;
    if (!alive(ext)) return 'no_extractor';
    if (ext.owner !== player) return 'not_owner';
  }
  if (!isExtractor(ctx, ext)) return 'bad_target';
  return workable(world, ctx, ext, player) ? null : 'depleted';
}

/**
 * GATHER: carriers in `units` work `target` (a crystal, a deposit with the player's extractor,
 * or the extractor itself), or return their load to `target` when it is the player's dropoff.
 * Other units in the list are left alone. The command was validated already.
 */
export function orderGather(world: World, ctx: SimContext, units: Entity[], target: Entity, player: number): void {
  const carriers = units.filter((u) => carryOf(ctx, u) > 0).sort((a, b) => a.id - b.id);
  if (isDropoffOf(ctx, target, player)) {
    for (const c of carriers) {
      if (c.cargo === 0) continue;
      const g = c.gather;
      releaseSlot(world, c);
      c.gather = { st: 'toDrop', target: g?.target ?? 0, field: g?.field ?? 0, tx: g?.tx ?? 0, ty: g?.ty ?? 0, drop: target.id, until: 0, tries: 0 };
      c.order = { kind: 'gather' };
      headForDropoff(world, ctx, c, target);
    }
    return;
  }
  let t: Entity = target;
  if (isDeposit(ctx, t)) t = entityById(world, t.res!.link)!;
  for (const c of carriers) stopGather(world, c);
  const assigned = countAssigned(world);
  const crystal = isCrystal(ctx, t);
  const field = crystal ? t.res!.field : 0;
  for (const c of carriers) {
    const pick = crystal ? (pickCrystal(world, ctx, c, field, t.x, t.y, assigned, 0) ?? t) : t;
    assigned.set(pick.id, (assigned.get(pick.id) ?? 0) + 1);
    c.gather = { st: 'toRes', target: pick.id, field, tx: pick.x, ty: pick.y, drop: 0, until: 0, tries: 0 };
    c.order = { kind: 'gather' };
    clearMove(world, c);
    if (c.cargo > 0) {
      // deliver what it holds first, then start on the new target
      c.gather.st = 'toDrop';
      const d = nearestDropoff(world, ctx, c);
      if (d) headForDropoff(world, ctx, c, d);
    } else headForTarget(world, ctx, c, pick);
  }
}

/** Rank of a carrier among those working the same target, to spread them over approach spots. */
function rankOf(world: World, e: Entity, target: number): number {
  let n = 0;
  for (const o of world.entities) if (o.id < e.id && o.gather?.target === target && o.hp > 0) n++;
  return n;
}

function headForTarget(world: World, ctx: SimContext, e: Entity, t: Entity): boolean {
  if (inReach(ctx, e, t)) return true;
  const d = nearestDropoff(world, ctx, e);
  const toward: [number, number] = d ? [d.x, d.y] : [e.x, e.y];
  const spot = approachSpot(ctx, t, toward, rankOf(world, e, t.id));
  if (!spot) return false;
  travelTo(world, ctx, e, spot[0], spot[1]);
  return true;
}

function headForDropoff(world: World, ctx: SimContext, e: Entity, d: Entity): boolean {
  e.gather!.drop = d.id;
  if (inReach(ctx, e, d)) return true;
  const spot = approachSpot(ctx, d, [e.x, e.y], 0);
  if (!spot) return false;
  travelTo(world, ctx, e, spot[0], spot[1]);
  return true;
}

// ---------------------------------------------------------------- the cycle

interface Phase {
  world: World;
  ctx: SimContext;
  assigned: Map<number, number>;
  events: GatherEvent[];
}

function stop(p: Phase, e: Entity, reason: GatherStopReason): void {
  releaseSlot(p.world, e);
  if (e.gather && e.gather.target !== 0) p.assigned.set(e.gather.target, (p.assigned.get(e.gather.target) ?? 1) - 1);
  e.gather = null;
  e.order = { kind: 'idle' };
  clearMove(p.world, e);
  p.events.push({ type: 'gather_stopped', entity: e.id, reason });
}

function switchTarget(p: Phase, e: Entity, g: GatherState, t: Entity): void {
  p.assigned.set(g.target, (p.assigned.get(g.target) ?? 1) - 1);
  p.assigned.set(t.id, (p.assigned.get(t.id) ?? 0) + 1);
  g.target = t.id;
  g.tx = t.x;
  g.ty = t.y;
  if (t.res && t.res.field !== 0) g.field = t.res.field;
  g.st = 'toRes';
  clearMove(p.world, e);
  if (!headForTarget(p.world, p.ctx, e, t)) g.tries = MAX_TRIES * 2; // walled in: the next look gives up
}

/** The target ran out or is gone: another crystal of the field, or nearby; otherwise stop. */
function retarget(p: Phase, e: Entity, g: GatherState): void {
  const { world, ctx } = p;
  if (g.field === 0) {
    const t = entityById(world, g.target);
    stop(p, e, alive(t) ? 'depleted' : 'no_extractor');
    return;
  }
  const next = pickCrystal(world, ctx, e, g.field, g.tx, g.ty, p.assigned, g.target);
  if (!next) {
    stop(p, e, 'depleted');
    return;
  }
  switchTarget(p, e, g, next);
}

/** Travel ended short of where it was going. Try again, then another target, then give up. */
function failedApproach(p: Phase, e: Entity, g: GatherState, toDrop: boolean): void {
  g.tries++;
  if (g.tries >= MAX_TRIES * 2) {
    stop(p, e, 'path_blocked');
    return;
  }
  const { world, ctx } = p;
  if (toDrop) {
    const current = entityById(world, g.drop);
    const d = g.tries >= MAX_TRIES ? (nearestDropoff(world, ctx, e, g.drop) ?? current) : current;
    if (!alive(d) || !headForDropoff(world, ctx, e, d)) stop(p, e, 'path_blocked');
    return;
  }
  const t = entityById(world, g.target);
  if (g.tries >= MAX_TRIES && g.field !== 0) {
    const other = pickCrystal(world, ctx, e, g.field, g.tx, g.ty, p.assigned, g.target);
    if (other) {
      const tries = g.tries;
      switchTarget(p, e, g, other);
      g.tries = Math.max(g.tries, tries);
      return;
    }
  }
  if (!alive(t) || !headForTarget(world, ctx, e, t)) stop(p, e, 'path_blocked');
}

function beginDropoff(p: Phase, e: Entity, g: GatherState): void {
  g.st = 'toDrop';
  const d = nearestDropoff(p.world, p.ctx, e);
  if (!d) {
    stop(p, e, 'no_dropoff');
    return;
  }
  g.tries = 0;
  if (!headForDropoff(p.world, p.ctx, e, d)) stop(p, e, 'path_blocked');
}

/** One carrier's tick. A stage that ends at once (arrived, slot free) flows into the next. */
function runCarrier(p: Phase, e: Entity): void {
  const { world, ctx } = p;
  for (let guard = 0; guard < 4 && e.gather; guard++) {
    const g = e.gather;
    switch (g.st) {
      case 'toRes':
      case 'wait': {
        const t = entityById(world, g.target);
        if (!workable(world, ctx, t, e.owner)) {
          retarget(p, e, g);
          return;
        }
        if (!inReach(ctx, e, t)) {
          if (g.st === 'wait') {
            g.st = 'toRes';
            if (!headForTarget(world, ctx, e, t)) stop(p, e, 'path_blocked');
          } else if (!e.mv) failedApproach(p, e, g, false);
          return;
        }
        if (e.mv) clearMove(world, e);
        g.tries = 0;
        if (reserve(t, e.id)) {
          g.st = 'harvest';
          g.until = world.tick + ctx.catalog.resources.get(sourceOf(world, ctx, t)!.type)!.harvestTicks;
          return;
        }
        // the slot is taken: a free crystal right next to this one, or wait in line
        if (g.st === 'toRes' || (world.tick - g.until) % WAIT_RECHECK === 0) {
          const alt = bounceCrystal(world, ctx, e, g, p.assigned);
          if (alt) {
            switchTarget(p, e, g, alt);
            continue;
          }
        }
        if (g.st === 'toRes') {
          g.st = 'wait';
          g.until = world.tick;
        }
        return;
      }
      case 'harvest': {
        const t = entityById(world, g.target);
        const src = alive(t) ? sourceOf(world, ctx, t) : undefined;
        if (!alive(t) || !alive(src) || !src.res || src.res.stock === 0) {
          // it ran out or was destroyed under the carrier
          releaseSlot(world, e);
          if (e.cargo > 0) beginDropoff(p, e, g);
          else retarget(p, e, g);
          return;
        }
        if (world.tick < g.until) return;
        const take = Math.min(carryOf(ctx, e) - e.cargo, src.res.stock);
        src.res.stock -= take;
        e.cargo += take;
        if (take > 0) e.cargoKind = kindOf(world, ctx, t);
        releaseSlot(world, e);
        if (e.cargo === 0) {
          retarget(p, e, g);
          return;
        }
        beginDropoff(p, e, g);
        return;
      }
      case 'toDrop': {
        let d = entityById(world, g.drop);
        if (!alive(d) || !isDropoffOf(ctx, d, e.owner)) {
          // the dropoff it was heading for is gone: the nearest other one, or stop holding the load
          const next = nearestDropoff(world, ctx, e);
          if (!next) {
            stop(p, e, 'no_dropoff');
            return;
          }
          g.tries = 0;
          clearMove(world, e);
          if (!headForDropoff(world, ctx, e, next)) {
            stop(p, e, 'path_blocked');
            return;
          }
          d = next;
        }
        if (!inReach(ctx, e, d)) {
          if (!e.mv) failedApproach(p, e, g, true);
          return;
        }
        if (e.mv) clearMove(world, e);
        g.tries = 0;
        g.st = 'unload';
        g.until = world.tick + UNLOAD_TICKS;
        return;
      }
      case 'unload': {
        const d = entityById(world, g.drop);
        if (!alive(d) || !isDropoffOf(ctx, d, e.owner)) {
          g.st = 'toDrop';
          g.drop = 0;
          continue;
        }
        if (world.tick < g.until) return;
        if (e.cargo > 0) {
          const pl = world.players[e.owner - 1]!;
          if (e.cargoKind === 'glucose') pl.basic += e.cargo;
          else pl.advanced += e.cargo;
          p.events.push({ type: 'delivered', entity: e.id, owner: e.owner, kind: e.cargoKind || 'glucose', amount: e.cargo, dropoff: d.id });
        }
        e.cargo = 0;
        e.cargoKind = '';
        g.drop = 0;
        if (g.target === 0) {
          // it only came to return a load
          e.gather = null;
          e.order = { kind: 'idle' };
          return;
        }
        g.st = 'toRes';
        const t = entityById(world, g.target);
        if (!workable(world, ctx, t, e.owner)) {
          retarget(p, e, g);
          return;
        }
        if (!headForTarget(world, ctx, e, t)) stop(p, e, 'path_blocked');
        return;
      }
    }
  }
}

/** Phase 7: every carrier on a gather order, in id order. */
export function gatherPhase(world: World, ctx: SimContext, events: GatherEvent[]): void {
  const p: Phase = { world, ctx, assigned: countAssigned(world), events };
  for (const e of world.entities) {
    if (!e.gather || e.hp <= 0) continue;
    runCarrier(p, e);
  }
}
