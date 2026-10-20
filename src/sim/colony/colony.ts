// The Colony's own ways (architecture tab, section 4): a feeder walks to a site and becomes
// the building; a fighting unit standing on its own biofilm, out of combat, can split in two.
//
// BUILD_AT pays at the order. If the site is lost before the feeder gets there, the money
// comes back in full. SPLIT pays the unit's full price and reserves its supply at the order;
// the unit stands still for half its training time, then a second one appears beside it.

import type { Cmd, RejectReason } from '../commands/commands';
import type { SimContext } from '../context';
import { SUB } from '../core/fixed';
import { entityById, removeEntity, spawnBuilding, type Entity, type World } from '../core/world';
import { requirementsMet } from '../build/production';
import { checkPlacement } from '../build/placement';
import { stopGather } from '../economy/gather';
import { afterFootprintChange, clearMove, travelTo } from '../navigation/movement';
import { BIOFILM_REGEN_EVERY } from './biofilm';

/** A unit splits only after this long without attacking or being hit. */
export const SPLIT_CALM = 60;
const BUILD_TRIES = 3;

export type ColonyEvent =
  | { type: 'became'; entity: number; building: number; owner: number }
  | { type: 'build_failed'; entity: number; owner: number; reason: RejectReason };

type BuildAt = Extract<Cmd, { type: 'BUILD_AT' }>;

const afford = (world: World, player: number, c: [number, number]) => {
  const p = world.players[player - 1]!;
  return p.basic >= c[0] && p.advanced >= c[1];
};

function buildsByMorph(world: World, ctx: SimContext, player: number): boolean {
  return ctx.catalog.factions.get(world.players[player - 1]!.faction)?.construction === 'morph';
}

/** The feeder that will build: the first worker in the list (by id) of the player's faction. */
function builderOf(ctx: SimContext, units: Entity[]): Entity | undefined {
  return [...units].sort((a, b) => a.id - b.id).find((u) => ctx.catalog.units.get(u.type)?.role === 'worker' && u.morph === null);
}

export function validateBuildAt(world: World, ctx: SimContext, player: number, cmd: BuildAt, units: Entity[]): RejectReason | null {
  if (!buildsByMorph(world, ctx, player)) return 'cannot_produce';
  if (!builderOf(ctx, units)) return 'no_feeder';
  const t = ctx.catalog.buildings.get(cmd.build);
  if (!t) return 'unknown_type';
  if (t.faction !== world.players[player - 1]!.faction || t.placement === 'none') return 'cannot_produce';
  if (!requirementsMet(world, player, t.requires)) return 'requirements';
  if (!afford(world, player, t.cost)) return 'no_resources';
  const c = checkPlacement(world, ctx, player, cmd.build, cmd.tx, cmd.ty);
  return c.ok ? null : c.reason;
}

export function applyBuildAt(world: World, ctx: SimContext, player: number, cmd: BuildAt, units: Entity[]): void {
  const f = builderOf(ctx, units)!;
  const t = ctx.catalog.buildings.get(cmd.build)!;
  const p = world.players[player - 1]!;
  p.basic -= t.cost[0];
  p.advanced -= t.cost[1];
  stopGather(world, f);
  clearMove(world, f);
  f.job = { kind: 'build_at', target: 0, tries: 0, next: 0, build: t.id, tx: cmd.tx, ty: cmd.ty, paid: [...t.cost] };
  f.order = { kind: 'job' };
  headToSite(world, ctx, f);
}

function siteCentre(ctx: SimContext, type: string, tx: number, ty: number): [number, number] {
  const [fw, fh] = ctx.catalog.buildings.get(type)!.footprint;
  return [tx * SUB + fw * (SUB / 2), ty * SUB + fh * (SUB / 2)];
}

function headToSite(world: World, ctx: SimContext, f: Entity): void {
  const j = f.job!;
  const [cx, cy] = siteCentre(ctx, j.build, j.tx, j.ty);
  travelTo(world, ctx, f, cx, cy);
}

/** Is the feeder at its site (on it, or touching its edge)? */
function atSite(ctx: SimContext, f: Entity): boolean {
  const j = f.job!;
  const [fw, fh] = ctx.catalog.buildings.get(j.build)!.footprint;
  const x0 = j.tx * SUB;
  const y0 = j.ty * SUB;
  const x1 = (j.tx + fw) * SUB - 1;
  const y1 = (j.ty + fh) * SUB - 1;
  const dx = f.x < x0 ? x0 - f.x : f.x > x1 ? f.x - x1 : 0;
  const dy = f.y < y0 ? y0 - f.y : f.y > y1 ? f.y - y1 : 0;
  const r = ctx.catalog.units.get(f.type)?.radius ?? 115;
  return dx * dx + dy * dy <= (r + 96) * (r + 96);
}

// ---------------------------------------------------------------- splitting

/** Can this unit split right now? A Colony fighter on its own biofilm, calm for a while. */
export function canSplit(world: World, ctx: SimContext, u: Entity): boolean {
  if (u.building || u.hp <= 0 || u.morph || !u.cb) return false;
  if (world.players[u.owner - 1]?.faction !== 'col') return false;
  if (ctx.biofilm.under(u) !== u.owner) return false;
  return world.tick - u.lastCombat >= SPLIT_CALM;
}

export function validateSplit(world: World, ctx: SimContext, player: number, units: Entity[]): RejectReason | null {
  const ok = units.filter((u) => canSplit(world, ctx, u));
  if (ok.length === 0) return 'cannot_split';
  const p = world.players[player - 1]!;
  let b = 0;
  let a = 0;
  let s = 0;
  for (const u of ok) {
    const d = ctx.catalog.units.get(u.type)!;
    b += d.cost[0];
    a += d.cost[1];
    s += d.supply;
  }
  if (p.basic < b || p.advanced < a) return 'no_resources';
  if (p.supplyUsed + p.supplyReserved + s > p.supplyCap) return 'supply_capped';
  return null;
}

export function applySplit(world: World, ctx: SimContext, player: number, units: Entity[]): void {
  const p = world.players[player - 1]!;
  for (const u of [...units].sort((a, b) => a.id - b.id)) {
    if (!canSplit(world, ctx, u)) continue;
    const d = ctx.catalog.units.get(u.type)!;
    if (p.basic < d.cost[0] || p.advanced < d.cost[1] || p.supplyUsed + p.supplyReserved + d.supply > p.supplyCap) continue;
    p.basic -= d.cost[0];
    p.advanced -= d.cost[1];
    p.supplyReserved += d.supply;
    stopGather(world, u);
    clearMove(world, u);
    if (u.cb) {
      u.cb.target = 0;
      u.cb.windupEnd = -1;
    }
    // a fever of 38–39 slows bacteria: splitting takes a fifth longer
    const fever = world.host !== null && world.host.infl >= 25_000 && world.host.infl < 50_000;
    const half = Math.max(1, Math.floor(d.trainTicks / 2));
    u.morph = { into: u.type, until: world.tick + (fever ? Math.floor((half * 6) / 5) : half), paid: [...d.cost], extra: d.supply, copy: true };
    u.order = { kind: 'morph' };
  }
}

// ---------------------------------------------------------------- phase 7

/** Feeders arriving at their sites become buildings; units on own biofilm heal. */
export function colonyPhase(world: World, ctx: SimContext, events: ColonyEvent[]): void {
  const tick = world.tick;
  const builders = world.entities.filter((e) => e.job?.kind === 'build_at' && e.hp > 0);
  for (const f of builders) {
    const j = f.job!;
    const p = world.players[f.owner - 1]!;
    const fail = (reason: RejectReason) => {
      p.basic += j.paid[0];
      p.advanced += j.paid[1];
      f.job = null;
      f.order = { kind: 'idle' };
      clearMove(world, f);
      events.push({ type: 'build_failed', entity: f.id, owner: f.owner, reason });
    };
    if (!atSite(ctx, f)) {
      if (!f.mv) {
        j.tries++;
        if (j.tries > BUILD_TRIES) fail('site_blocked');
        else headToSite(world, ctx, f);
      }
      continue;
    }
    const c = checkPlacement(world, ctx, f.owner, j.build, j.tx, j.ty);
    if (!c.ok) {
      fail(c.reason);
      continue;
    }
    // the feeder is swallowed into the building it becomes
    const owner = f.owner;
    const [cx, cy] = siteCentre(ctx, j.build, j.tx, j.ty);
    const paid = j.paid;
    const [fw, fh] = ctx.catalog.buildings.get(j.build)!.footprint;
    const [tx, ty] = [j.tx, j.ty];
    removeEntity(world, ctx, f.id);
    const b = spawnBuilding(world, ctx, j.build, owner, cx, cy, paid);
    if (c.deposit) {
      b.res!.link = c.deposit;
      entityById(world, c.deposit)!.res!.link = b.id;
    }
    afterFootprintChange(world, ctx, tx, ty, fw, fh);
    events.push({ type: 'became', entity: f.id, building: b.id, owner });
  }
  // own biofilm mends the Colony's units, a hit point at a time
  for (const e of world.entities) {
    if (e.building || e.hp <= 0 || e.hp >= e.maxHp || e.owner === 0) continue;
    if ((tick + e.id) % BIOFILM_REGEN_EVERY !== 0) continue;
    if (world.players[e.owner - 1]!.faction !== 'col' || ctx.biofilm.under(e) !== e.owner) continue;
    e.hp++;
  }
}
