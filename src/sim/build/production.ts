// Production and construction (phase 7, after gathering), and the orders that feed them.
//
// Money and supply move in single actions: an order pays and reserves supply together, a
// cancel refunds once, a finished unit turns its reserved supply into used supply. Every
// queue item is paid exactly once and refunded at most once.

import type { Cmd, RejectReason } from '../commands/commands';
import { footprintOrigin, type SimContext } from '../context';
import { SUB } from '../core/fixed';
import { entityById, newCombat, removeEntity, spawnBuilding, spawnUnit, supplyCapOf, growthHp, type Entity, type Player, type World } from '../core/world';
import { carryOf, inReach, orderGather, stopGather, validateGather } from '../economy/gather';
import { centreOf, CLASS_SIZE } from '../navigation/grid';
import { afterFootprintChange, clearMove, issueMove, travelTo } from '../navigation/movement';
import { checkPlacement, exitTile } from './placement';

export const QUEUE_MAX = 5;
/** Refund for a started unit or a growing building, in thousandths. */
export const CANCEL_REFUND = 750;
/** Extra growth speed from the first and second builder squad, in thousandths; more add nothing. */
export const ASSIST_BONUS = [500, 250];
/** Repair: one step every this many ticks; a full repair takes the build time and costs a quarter of the price. */
export const REPAIR_STEP = 10;
export const REPAIR_COST = 250;
/** How far around a production exit a new unit may appear. */
const EXIT_SEARCH = 3;
const HELP_TRIES = 3;

export type BuildEvent =
  | { type: 'trained'; entity: number; building: number; owner: number }
  | { type: 'exit_blocked'; building: number; owner: number }
  | { type: 'placed'; entity: number; owner: number }
  | { type: 'built'; entity: number; owner: number }
  | { type: 'refunded'; owner: number; basic: number; advanced: number; reason: 'cancel' | 'lost' }
  | { type: 'morphed'; entity: number; owner: number }
  | { type: 'job_ended'; entity: number; reason: 'done' | 'gone' | 'path_blocked' };

type BuildingCmd = Extract<Cmd, { type: 'TRAIN' | 'CANCEL' | 'QUEUE_BUILD' | 'PLACE_BUILD' | 'SET_RALLY' }>;
type UnitJobCmd = Extract<Cmd, { type: 'ASSIST_BUILD' | 'REPAIR' | 'DEPLOY' }>;

// ---------------------------------------------------------------- money and requirements

const playerOf = (world: World, id: number): Player => world.players[id - 1]!;
const times = (c: [number, number], n: number): [number, number] => [c[0] * n, c[1] * n];
const afford = (p: Player, c: [number, number]) => p.basic >= c[0] && p.advanced >= c[1];

function pay(p: Player, c: [number, number]): void {
  p.basic -= c[0];
  p.advanced -= c[1];
}

/** Gives back `permille` of `paid` (rounded down) and reports it. */
function refund(world: World, owner: number, paid: [number, number], permille: number, reason: 'cancel' | 'lost', events: BuildEvent[]): void {
  const b = Math.floor((paid[0] * permille) / 1000);
  const a = Math.floor((paid[1] * permille) / 1000);
  if (b === 0 && a === 0) return;
  const p = playerOf(world, owner);
  p.basic += b;
  p.advanced += a;
  events.push({ type: 'refunded', owner, basic: b, advanced: a, reason });
}

export const isComplete = (e: Entity) => e.build === null && e.hp > 0;

export function hasComplete(world: World, owner: number, type: string): boolean {
  return world.entities.some((e) => e.owner === owner && e.type === type && e.building && isComplete(e));
}

/** Building requirements; an antigen requirement opens only through a delivered sample (gate 6). */
export function requirementsMet(world: World, owner: number, reqs: string[]): boolean {
  return reqs.every((r) => !r.startsWith('antigen:') && hasComplete(world, owner, r));
}

/** Can this player's lymph node order buildings? (The Colony builds with feeders, the Crown hijacks: gate 6.) */
function ordersBuildings(ctx: SimContext, world: World, b: Entity): boolean {
  const f = ctx.catalog.factions.get(playerOf(world, b.owner).faction);
  return f !== undefined && f.construction === 'order' && f.hq === b.type;
}

// ---------------------------------------------------------------- validation

export function validateBuildingCmd(world: World, ctx: SimContext, player: number, cmd: BuildingCmd): RejectReason | null {
  const { catalog } = ctx;
  const b = entityById(world, cmd.building);
  if (!b || b.hp <= 0) return 'unknown_target';
  if (b.owner !== player) return 'not_owner';
  if (!b.building || !catalog.buildings.has(b.type)) return 'not_a_building';
  const p = playerOf(world, player);
  switch (cmd.type) {
    case 'TRAIN': {
      if (b.build) return 'not_ready';
      if (!b.queue || !catalog.buildings.get(b.type)!.produces.includes(cmd.unit)) return 'cannot_produce';
      if (cmd.count < 1 || cmd.count > QUEUE_MAX) return 'bad_count';
      if (b.queue.length + cmd.count > QUEUE_MAX) return 'queue_full';
      const u = catalog.units.get(cmd.unit)!;
      if (!requirementsMet(world, player, u.requires)) return 'requirements';
      if (!afford(p, times(u.cost, cmd.count))) return 'no_resources';
      if (p.supplyUsed + p.supplyReserved + u.supply * cmd.count > p.supplyCap) return 'supply_capped';
      return null;
    }
    case 'CANCEL': {
      if (cmd.what === 'queue') {
        const q = b.queue ?? [];
        const i = cmd.index < 0 ? q.length - 1 : cmd.index;
        return i >= 0 && i < q.length ? null : 'nothing_to_cancel';
      }
      if (cmd.what === 'build') return b.build ? null : 'nothing_to_cancel';
      return b.buildOrder ? null : 'nothing_to_cancel';
    }
    case 'QUEUE_BUILD': {
      if (b.build) return 'not_ready';
      if (!ordersBuildings(ctx, world, b)) return 'cannot_produce';
      if (b.buildOrder) return 'queue_full';
      const t = catalog.buildings.get(cmd.build);
      if (!t) return 'unknown_type';
      if (t.faction !== p.faction || t.placement === 'none' || t.placement === 'biofilm') return 'cannot_produce';
      if (!requirementsMet(world, player, t.requires)) return 'requirements';
      if (!afford(p, t.cost)) return 'no_resources';
      return null;
    }
    case 'PLACE_BUILD': {
      if (!b.buildOrder) return 'no_order';
      const c = checkPlacement(world, ctx, player, b.buildOrder.type, cmd.tx, cmd.ty);
      return c.ok ? null : c.reason;
    }
    case 'SET_RALLY': {
      if (!b.queue) return 'cannot_produce';
      if (cmd.x < 0 || cmd.y < 0 || cmd.x >= world.mapW || cmd.y >= world.mapH) return 'out_of_bounds';
      if (cmd.target !== 0) {
        const t = entityById(world, cmd.target);
        if (!t || t.hp <= 0) return 'unknown_target';
      }
      return null;
    }
  }
}

export function validateUnitJob(world: World, ctx: SimContext, player: number, cmd: UnitJobCmd, units: Entity[]): RejectReason | null {
  const { catalog } = ctx;
  const p = playerOf(world, player);
  if (cmd.type === 'DEPLOY') {
    const morphing = units.filter((u) => catalog.units.get(u.type)?.morphsTo && !u.morph);
    if (morphing.length === 0) return 'cannot_deploy';
    const into = catalog.units.get(catalog.units.get(morphing[0]!.type)!.morphsTo!)!;
    if (morphing.some((u) => catalog.units.get(u.type)!.morphsTo !== into.id)) return 'cannot_deploy';
    if (!requirementsMet(world, player, into.requires)) return 'requirements';
    if (!afford(p, times(into.cost, morphing.length))) return 'no_resources';
    const extra = (into.supply - catalog.units.get(morphing[0]!.type)!.supply) * morphing.length;
    if (extra > 0 && p.supplyUsed + p.supplyReserved + extra > p.supplyCap) return 'supply_capped';
    return null;
  }
  if (!units.some((u) => catalog.units.get(u.type)?.role === 'builder')) return 'no_builders';
  const t = entityById(world, cmd.target);
  if (!t || t.hp <= 0) return 'unknown_target';
  if (t.owner !== player || !t.building || !catalog.buildings.has(t.type)) return 'bad_target';
  if (cmd.type === 'ASSIST_BUILD') return t.build ? null : 'nothing_to_do';
  return !t.build && t.hp < t.maxHp ? null : 'nothing_to_do';
}

// ---------------------------------------------------------------- orders

export function applyBuildingCmd(world: World, ctx: SimContext, player: number, cmd: BuildingCmd, events: BuildEvent[]): void {
  const { catalog } = ctx;
  const b = entityById(world, cmd.building)!;
  const p = playerOf(world, player);
  switch (cmd.type) {
    case 'TRAIN': {
      const u = catalog.units.get(cmd.unit)!;
      for (let k = 0; k < cmd.count; k++) {
        pay(p, u.cost);
        p.supplyReserved += u.supply;
        b.queue!.push({ unit: u.id, paid: [...u.cost], done: 0, started: false, blocked: false });
      }
      return;
    }
    case 'CANCEL': {
      if (cmd.what === 'queue') {
        const q = b.queue!;
        const i = cmd.index < 0 ? q.length - 1 : cmd.index;
        const [item] = q.splice(i, 1);
        p.supplyReserved -= catalog.units.get(item!.unit)!.supply;
        refund(world, player, item!.paid, item!.started ? CANCEL_REFUND : 1000, 'cancel', events);
      } else if (cmd.what === 'build') {
        refund(world, player, b.build!.paid, CANCEL_REFUND, 'cancel', events);
        removeEntity(world, ctx, b.id);
      } else {
        refund(world, player, b.buildOrder!.paid, 1000, 'cancel', events);
        b.buildOrder = null;
      }
      return;
    }
    case 'QUEUE_BUILD': {
      const t = catalog.buildings.get(cmd.build)!;
      pay(p, t.cost);
      b.buildOrder = { type: t.id, paid: [...t.cost] };
      return;
    }
    case 'PLACE_BUILD': {
      const order = b.buildOrder!;
      const c = checkPlacement(world, ctx, player, order.type, cmd.tx, cmd.ty);
      if (!c.ok) return; // validated just before; cannot happen
      const [fw, fh] = catalog.buildings.get(order.type)!.footprint;
      const nb = spawnBuilding(world, ctx, order.type, player, cmd.tx * SUB + fw * (SUB / 2), cmd.ty * SUB + fh * (SUB / 2), order.paid);
      if (c.deposit) {
        nb.res!.link = c.deposit;
        entityById(world, c.deposit)!.res!.link = nb.id;
      }
      b.buildOrder = null;
      afterFootprintChange(world, ctx, cmd.tx, cmd.ty, fw, fh);
      events.push({ type: 'placed', entity: nb.id, owner: player });
      return;
    }
    case 'SET_RALLY':
      b.rally = { x: cmd.x, y: cmd.y, target: cmd.target };
      return;
  }
}

export function applyUnitJob(world: World, ctx: SimContext, player: number, cmd: UnitJobCmd, units: Entity[]): void {
  const { catalog } = ctx;
  const p = playerOf(world, player);
  if (cmd.type === 'DEPLOY') {
    for (const u of [...units].sort((a, b) => a.id - b.id)) {
      const from = catalog.units.get(u.type)!;
      if (!from.morphsTo || u.morph) continue;
      const into = catalog.units.get(from.morphsTo)!;
      const extra = Math.max(0, into.supply - from.supply);
      stopGather(world, u);
      clearMove(world, u);
      u.job = null;
      pay(p, into.cost);
      p.supplyReserved += extra;
      u.morph = { into: into.id, until: world.tick + into.trainTicks, paid: [...into.cost], extra };
      u.order = { kind: 'morph' };
    }
    return;
  }
  const kind = cmd.type === 'ASSIST_BUILD' ? 'assist' : 'repair';
  const t = entityById(world, cmd.target)!;
  for (const u of units) {
    if (catalog.units.get(u.type)?.role !== 'builder' || u.morph) continue;
    stopGather(world, u);
    clearMove(world, u);
    u.job = { kind, target: t.id, tries: 0, next: world.tick };
    u.order = { kind: 'job' };
    headFor(world, ctx, u, t);
  }
}

/** Walks a builder to the open side of a building nearest to it. */
function headFor(world: World, ctx: SimContext, u: Entity, t: Entity): void {
  if (inReach(ctx, u, t)) return;
  const [tx, ty, fw, fh] = footprintOrigin(ctx, t.type, t.x, t.y);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let y = ty - 1; y <= ty + fh; y++) {
    for (let x = tx - 1; x <= tx + fw; x++) {
      if (x !== tx - 1 && x !== tx + fw && y !== ty - 1 && y !== ty + fh) continue;
      if (!ctx.nav.passable(x, y, 1)) continue;
      const cx = x * SUB + SUB / 2;
      const cy = y * SUB + SUB / 2;
      const d = (cx - u.x) * (cx - u.x) + (cy - u.y) * (cy - u.y);
      if (d < bd) {
        bd = d;
        best = [cx, cy];
      }
    }
  }
  if (best) travelTo(world, ctx, u, best[0], best[1]);
}

// ---------------------------------------------------------------- the phase

function endJob(u: Entity, reason: 'done' | 'gone' | 'path_blocked', world: World, events: BuildEvent[]): void {
  u.job = null;
  u.order = { kind: 'idle' };
  clearMove(world, u);
  events.push({ type: 'job_ended', entity: u.id, reason });
}

/**
 * Where a new unit appears: the free spot nearest the exit, among those it can walk to from
 * the building (a search through open ground, so never on the far side of a wall), within
 * EXIT_SEARCH tiles of the exit. Null when the exit is walled in.
 */
function spawnSpot(ctx: SimContext, b: Entity, unit: string): [number, number] | null {
  const nav = ctx.nav;
  const size = CLASS_SIZE[ctx.catalog.units.get(unit)!.navClass];
  const [ex, ey] = exitTile(ctx, b);
  const [tx, ty, fw, fh] = footprintOrigin(ctx, b.type, b.x, b.y);
  const x0 = Math.min(tx, ex - EXIT_SEARCH);
  const y0 = Math.min(ty, ey - EXIT_SEARCH);
  const x1 = Math.max(tx + fw - 1, ex + EXIT_SEARCH);
  const y1 = Math.max(ty + fh - 1, ey + EXIT_SEARCH);
  const w = x1 - x0 + 1;
  const seen = new Uint8Array(w * (y1 - y0 + 1));
  const todo: number[] = [];
  for (let y = ty; y < ty + fh; y++)
    for (let x = tx; x < tx + fw; x++) {
      seen[(y - y0) * w + (x - x0)] = 1;
      todo.push(x, y);
    }
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let k = 0; k < todo.length; k += 2) {
    const cx = todo[k]!;
    const cy = todo[k + 1]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < x0 || x > x1 || y < y0 || y > y1 || seen[(y - y0) * w + (x - x0)]) continue;
      seen[(y - y0) * w + (x - x0)] = 1;
      if (!nav.passable(x, y, 1)) continue;
      todo.push(x, y);
      if (Math.max(Math.abs(x - ex), Math.abs(y - ey)) > EXIT_SEARCH || !nav.passable(x, y, size)) continue;
      const d = (x - ex) * (x - ex) + (y - ey) * (y - ey);
      if (d < bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best ? centreOf(best[0], best[1], size) : null;
}

/** A new unit goes to the building's rally: a crystal to mine (carriers), a unit to join, or a point. */
function sendToRally(world: World, ctx: SimContext, b: Entity, u: Entity): void {
  const r = b.rally;
  if (!r) return;
  const t = r.target !== 0 ? entityById(world, r.target) : undefined;
  if (t && t.hp > 0) {
    if (carryOf(ctx, u) > 0 && validateGather(world, ctx, u.owner, t) === null) {
      orderGather(world, ctx, [u], t, u.owner);
      return;
    }
    if (!t.building) {
      issueMove(world, ctx, [u], t.x, t.y);
      return;
    }
  }
  issueMove(world, ctx, [u], r.x, r.y);
}

/** Phase 7, after gathering: morphs, builders, growth, then production queues; all in id order. */
export function productionPhase(world: World, ctx: SimContext, events: BuildEvent[]): void {
  const { catalog } = ctx;
  const tick = world.tick;

  // morphs that are done
  for (const u of world.entities) {
    if (!u.morph || u.hp <= 0 || tick < u.morph.until) continue;
    const from = catalog.units.get(u.type)!;
    const into = catalog.units.get(u.morph.into)!;
    const p = playerOf(world, u.owner);
    p.supplyUsed += into.supply - from.supply;
    p.supplyReserved -= u.morph.extra;
    u.hp = Math.max(1, Math.floor((u.hp * into.hp) / u.maxHp));
    u.maxHp = into.hp;
    u.type = into.id;
    u.morph = null;
    u.order = { kind: 'idle' };
    u.cb = into.weapon ? newCombat() : null;
    events.push({ type: 'morphed', entity: u.id, owner: u.owner });
  }

  // builders: walk to their building, then help it grow or repair it
  const helpers = new Map<number, number>(); // building → builder squads at work on it
  for (const u of world.entities) {
    const job = u.job;
    if (!job || u.hp <= 0) continue;
    const t = entityById(world, job.target);
    if (!t || t.hp <= 0 || t.owner !== u.owner) {
      endJob(u, 'gone', world, events);
      continue;
    }
    if (job.kind === 'assist' ? !t.build : t.build !== null || t.hp >= t.maxHp) {
      endJob(u, 'done', world, events);
      continue;
    }
    if (!inReach(ctx, u, t)) {
      if (!u.mv) {
        job.tries++;
        if (job.tries > HELP_TRIES) endJob(u, 'path_blocked', world, events);
        else headFor(world, ctx, u, t);
      }
      continue;
    }
    if (u.mv) clearMove(world, u);
    job.tries = 0;
    if (job.kind === 'assist') {
      helpers.set(t.id, (helpers.get(t.id) ?? 0) + 1);
      continue;
    }
    // repair, paid step by step; it waits while the money is short
    if (tick < job.next) continue;
    const def = catalog.buildings.get(t.type)!;
    const time = Math.max(def.buildTicks, 600);
    const heal = Math.min(t.maxHp - t.hp, Math.ceil((t.maxHp * REPAIR_STEP) / time));
    const basis = def.cost[0] > 0 ? def.cost[0] : 400;
    const cost = Math.ceil((basis * REPAIR_COST * heal) / (1000 * t.maxHp));
    const p = playerOf(world, u.owner);
    if (p.basic < cost) continue;
    p.basic -= cost;
    t.hp += heal;
    job.next = tick + REPAIR_STEP;
  }

  // growing buildings
  for (const b of world.entities) {
    const g = b.build;
    if (!g || b.hp <= 0) continue;
    const squads = helpers.get(b.id) ?? 0;
    let rate = 1000;
    for (let k = 0; k < Math.min(squads, ASSIST_BONUS.length); k++) rate += ASSIST_BONUS[k]!;
    const before = growthHp(b.maxHp, g.progress, g.total);
    g.progress = Math.min(g.total, g.progress + rate);
    b.hp = Math.min(b.maxHp, b.hp + growthHp(b.maxHp, g.progress, g.total) - before);
    if (g.progress >= g.total) {
      b.build = null;
      playerOf(world, b.owner).supplyCap = supplyCapOf(world, catalog, b.owner);
      events.push({ type: 'built', entity: b.id, owner: b.owner });
    }
  }

  // production queues. A waiting item starts only while the owner is under the supply cap
  // (counting items already training), so a lost supply building pauses new items only.
  const training = new Map<number, number>();
  for (const b of world.entities) for (const q of b.queue ?? []) if (q.started) training.set(b.owner, (training.get(b.owner) ?? 0) + catalog.units.get(q.unit)!.supply);
  for (const b of world.entities) {
    const q = b.queue;
    if (!q || q.length === 0 || b.hp <= 0 || b.build) continue;
    const item = q[0]!;
    const u = catalog.units.get(item.unit)!;
    const p = playerOf(world, b.owner);
    if (!item.started) {
      const busy = training.get(b.owner) ?? 0;
      if (p.supplyUsed + busy + u.supply > p.supplyCap) continue;
      item.started = true;
      training.set(b.owner, busy + u.supply);
    }
    let fresh = false;
    if (!item.blocked) {
      item.done++;
      if (item.done < u.trainTicks) continue;
      item.blocked = true; // trained: from here on it only waits for room at the exit
      fresh = true;
    }
    const spot = spawnSpot(ctx, b, u.id);
    if (!spot) {
      if (fresh) events.push({ type: 'exit_blocked', building: b.id, owner: b.owner });
      continue;
    }
    q.shift();
    p.supplyReserved -= u.supply;
    training.set(b.owner, (training.get(b.owner) ?? 0) - u.supply);
    const nu = spawnUnit(world, catalog, u.id, b.owner, spot[0], spot[1]);
    events.push({ type: 'trained', entity: nu.id, building: b.id, owner: b.owner });
    sendToRally(world, ctx, b, nu);
  }
}

/**
 * A building or unit is about to be removed by the death phase: waiting units in its queue
 * and an unplaced building order are refunded in full; what was already training is lost;
 * a growing building is lost without refund. (Reserved supply is released by removeEntity.)
 */
export function settleLoss(world: World, e: Entity, events: BuildEvent[]): void {
  if (e.owner === 0) return;
  for (const q of e.queue ?? []) if (!q.started) refund(world, e.owner, q.paid, 1000, 'lost', events);
  if (e.buildOrder) refund(world, e.owner, e.buildOrder.paid, 1000, 'lost', events);
}
