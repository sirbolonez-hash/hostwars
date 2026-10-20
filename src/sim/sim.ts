// One simulation tick, in the order written in the architecture (tab 2, section 3).
// Phases that later gates fill in are listed in place so the order never shifts.

import { validate, type CommandEnvelope, type RejectReason, type Rejection } from './commands/commands';
import { footprintOrigin, type SimContext } from './context';
import { isqrt, SUB } from './core/fixed';
import { Hasher } from './core/hash';
import { entityById, removeEntity, spawnBuilding, spawnUnit, supplyCapOf, type Entity, type World } from './core/world';
import { applyBuildingCmd, applyUnitJob, productionPhase, QUEUE_MAX, settleLoss, type BuildEvent } from './build/production';
import { carryOf, gatherPhase, isCrystal, isDeposit, isExtractor, orderGather, stopGather, type GatherEvent } from './economy/gather';
import { centreOf, CLASS_SIZE } from './navigation/grid';
import { nearestPassable } from './navigation/slots';
import { afterFootprintChange, clearMove, issueMove, moveUnits, processPathQueue, type MoveEvent } from './navigation/movement';

export type DeathCause = 'lifespan' | 'damage' | 'depleted';

export type SimEvent =
  | { tick: number; type: 'rejected'; rejection: Rejection }
  | { tick: number; type: 'arrived'; entity: number }
  | { tick: number; type: 'blocked'; entity: number }
  | ({ tick: number } & GatherEvent)
  | ({ tick: number } & BuildEvent)
  /** `cargo`: the load it was carrying, lost with it */
  | { tick: number; type: 'died'; entity: number; entityType: string; owner: number; cause: DeathCause; cargo: number };

export interface StepStats {
  pathExpansions: number;
}

export interface StepResult {
  events: SimEvent[];
  hash: string;
  stats: StepStats;
}

function indexOf(world: World): Map<number, Entity> {
  const m = new Map<number, Entity>();
  for (const e of world.entities) m.set(e.id, e);
  return m;
}

/** Advances the world by one tick. `commands` must already be the ones scheduled for this tick. */
export function step(world: World, ctx: SimContext, commands: CommandEnvelope[]): StepResult {
  const { catalog } = ctx;
  const events: SimEvent[] = [];
  const tick = world.tick;

  // 1. commands for this tick, in canonical order (the queue already sorted them)
  // 2. expire timed effects; refresh vision for the start of the tick        (gate 5)

  // 3. validate and apply commands
  let index = indexOf(world);
  for (const env of commands) {
    const reason = env.tick !== tick ? 'late' : validate(world, env, index, ctx);
    // a command can still fail while it runs (a building site found taken); it then changes nothing
    const failed = reason ?? applyCommand(world, ctx, env, index, events);
    if (failed) events.push({ tick, type: 'rejected', rejection: { player: env.player, seq: env.seq, reason: failed } });
    if (!reason) index = indexOf(world);
  }

  // 4. AI decisions are commands for a later tick; they enter through the queue (gate 6)

  // 5. path searches under the tick budget, then movement
  index = indexOf(world);
  const pathExpansions = processPathQueue(world, ctx, index);
  const moveEvents: MoveEvent[] = [];
  moveUnits(world, ctx, moveEvents);
  for (const m of moveEvents) events.push({ tick, ...m });

  // 6. spatial index and vision after movement                              (gate 5)
  // 7. economy: gathering, then morphs, builders, growth and production queues (research: gate 6)
  const gatherEvents: GatherEvent[] = [];
  gatherPhase(world, ctx, gatherEvents);
  for (const g of gatherEvents) events.push({ tick, ...g });
  const buildEvents: BuildEvent[] = [];
  productionPhase(world, ctx, buildEvents);
  for (const b of buildEvents) events.push({ tick, ...b });
  // 8. targeting, weapon cooldowns, firing                                  (gate 5)
  // 9. projectiles and hits: damage first, then healing                     (gate 5)

  // 10. death: lifespans, hit points, emptied resources; release supply, footprints,
  //     path requests, work slots and links. A load on the way dies with its carrier.
  const dying: { e: Entity; cause: DeathCause }[] = [];
  for (const e of world.entities) {
    if (e.hp <= 0) {
      dying.push({ e, cause: 'damage' });
      continue;
    }
    if (!e.building) {
      const life = catalog.units.get(e.type)?.lifespan ?? 0;
      if (life > 0 && tick - e.bornTick >= life) dying.push({ e, cause: 'lifespan' });
    } else if (e.res && e.res.stock === 0 && catalog.resources.has(e.type)) dying.push({ e, cause: 'depleted' });
  }
  const lossEvents: BuildEvent[] = [];
  for (const { e, cause } of dying) {
    settleLoss(world, e, lossEvents);
    removeEntity(world, ctx, e.id);
    events.push({ tick, type: 'died', entity: e.id, entityType: e.type, owner: e.owner, cause, cargo: e.cargo });
  }
  for (const l of lossEvents) events.push({ tick, ...l });

  // 11. host monitor: inflammation, fever, pressure, saturation              (gate 7)
  // 12. mission triggers, victory check, events, hash
  world.tick = tick + 1;
  return { events, hash: hashWorld(world, ctx), stats: { pathExpansions } };
}

/** A new order ends gathering (the slot is released, the load kept) and a builder's job. */
function endWork(world: World, e: Entity): void {
  stopGather(world, e);
  if (e.job) {
    e.job = null;
    if (e.order.kind === 'job') e.order = { kind: 'idle' };
  }
}

/** Runs a validated command. Returns a reason when it turns out it cannot run; then nothing changed. */
function applyCommand(world: World, ctx: SimContext, env: CommandEnvelope, index: Map<number, Entity>, events: SimEvent[]): RejectReason | null {
  // a unit that is turning into another takes no orders until it is done
  const units = env.cmd.units.map((id) => index.get(id)).filter((e): e is Entity => e !== undefined && e.morph === null);
  const buildEvents: BuildEvent[] = [];
  switch (env.cmd.type) {
    case 'MOVE':
      for (const e of units) endWork(world, e);
      issueMove(world, ctx, units, env.cmd.x, env.cmd.y);
      break;
    case 'STOP':
      for (const e of units) {
        endWork(world, e);
        clearMove(world, e);
        e.order = { kind: 'idle' };
      }
      break;
    case 'HOLD':
      for (const e of units) {
        endWork(world, e);
        clearMove(world, e);
        e.order = { kind: 'hold' };
      }
      break;
    case 'GATHER':
      for (const e of units) if (e.job) endWork(world, e);
      orderGather(world, ctx, units, index.get(env.cmd.target)!, env.player);
      break;
    case 'ASSIST_BUILD':
    case 'REPAIR':
    case 'DEPLOY':
      applyUnitJob(world, ctx, env.player, env.cmd, units);
      break;
    case 'TRAIN':
    case 'CANCEL':
    case 'QUEUE_BUILD':
    case 'PLACE_BUILD':
    case 'SET_RALLY':
      applyBuildingCmd(world, ctx, env.player, env.cmd, buildEvents);
      for (const b of buildEvents) events.push({ tick: world.tick, ...b });
      break;
    case 'DEV_GRANT': {
      const p = world.players[env.player - 1]!;
      p.basic += env.cmd.basic;
      p.advanced += env.cmd.advanced;
      break;
    }
    case 'DEV_KILL':
      for (const id of env.cmd.targets) {
        const e = index.get(id);
        if (e) e.hp = 0;
      }
      break;
    case 'DEV_SPAWN': {
      if (ctx.catalog.buildings.has(env.cmd.unit)) return devPlaceBuilding(world, ctx, env.player, env.cmd.unit, env.cmd.x, env.cmd.y);
      // a square block around the point, each body on the nearest tile it can stand on
      const def = ctx.catalog.units.get(env.cmd.unit)!;
      const size = CLASS_SIZE[def.navClass];
      const side = isqrt(env.cmd.count - 1) + 1; // ceil(sqrt(count))
      const tx = Math.floor(env.cmd.x / 256);
      const ty = Math.floor(env.cmd.y / 256);
      for (let k = 0; k < env.cmd.count; k++) {
        const cx = tx + (k % side) * size - Math.floor((side * size) / 2);
        const cy = ty + Math.floor(k / side) * size - Math.floor((side * size) / 2);
        const node = nearestPassable(ctx.nav, cx, cy, size, 6);
        if (!node) continue;
        const [x, y] = centreOf(node[0], node[1], size);
        spawnUnit(world, ctx.catalog, env.cmd.unit, env.player, x, y);
      }
      break;
    }
  }
  return null;
}

/**
 * Test matches: puts a finished building with its centre on the tile under (x, y). The
 * footprint must be open ground with no unit on it; an extractor goes on the free deposit
 * of its kind under that point instead. Construction proper arrives in gate 4.
 */
function devPlaceBuilding(world: World, ctx: SimContext, player: number, type: string, x: number, y: number): RejectReason | null {
  const def = ctx.catalog.buildings.get(type)!;
  if (def.faction !== world.players[player - 1]!.faction) return 'bad_target';
  const tx = Math.floor(x / SUB);
  const ty = Math.floor(y / SUB);
  if (def.onResource) {
    const dep = world.entities.find((e) => {
      if (!isDeposit(ctx, e) || e.res!.link !== 0 || ctx.catalog.resources.get(e.type)!.kind !== def.onResource) return false;
      const [ox, oy, fw, fh] = footprintOrigin(ctx, e.type, e.x, e.y);
      return tx >= ox && tx < ox + fw && ty >= oy && ty < oy + fh;
    });
    if (!dep) return 'site_blocked';
    const b = spawnBuilding(world, ctx, type, player, dep.x, dep.y);
    b.res!.link = dep.id;
    dep.res!.link = b.id;
    return null;
  }
  const [fw, fh] = def.footprint;
  const ox = tx - Math.floor((fw - 1) / 2);
  const oy = ty - Math.floor((fh - 1) / 2);
  for (let y2 = oy; y2 < oy + fh; y2++) for (let x2 = ox; x2 < ox + fw; x2++) if (ctx.nav.blocked(x2, y2)) return 'site_blocked';
  for (const e of world.entities) {
    if (e.building) continue;
    const ux = Math.floor(e.x / SUB);
    const uy = Math.floor(e.y / SUB);
    if (ux >= ox - 1 && ux <= ox + fw && uy >= oy - 1 && uy <= oy + fh) return 'site_blocked';
  }
  spawnBuilding(world, ctx, type, player, ox * SUB + fw * (SUB / 2), oy * SUB + fh * (SUB / 2));
  afterFootprintChange(world, ctx, ox, oy, fw, fh);
  return null;
}

/** Canonical hash of everything that affects the future of the match. */
export function hashWorld(world: World, ctx: SimContext): string {
  const h = new Hasher();
  h.str(world.contentHash).str(world.map).bool(world.dev).int(world.tick).int(world.seed).int(world.nextId).int(world.mapW).int(world.mapH);
  h.int(world.rng.a).int(world.rng.b).int(world.rng.c).int(world.rng.d);
  for (const p of world.players) {
    h.int(p.id).str(p.faction).int(p.team).int(p.basic).int(p.advanced).int(p.supplyUsed).int(p.supplyReserved).int(p.supplyCap).bool(p.defeated);
  }
  h.int(world.entities.length);
  for (const e of world.entities) {
    h.int(e.id).int(ctx.catalog.typeIndex.get(e.type) ?? -1).int(e.owner).int(e.x).int(e.y).int(e.hp).int(e.maxHp).bool(e.building).int(e.bornTick);
    switch (e.order.kind) {
      case 'idle':
        h.int(0);
        break;
      case 'hold':
        h.int(1);
        break;
      case 'move':
        h.int(2).int(e.order.x).int(e.order.y);
        break;
      case 'gather':
        h.int(3);
        break;
      case 'job':
        h.int(4);
        break;
      case 'morph':
        h.int(5);
        break;
    }
    if (!e.res) h.int(-1);
    else {
      h.int(e.res.stock).int(e.res.field).int(e.res.link).int(e.res.slots.length);
      for (const v of e.res.slots) h.int(v);
    }
    const g = e.gather;
    if (!g) h.int(-1);
    else h.str(g.st).int(g.target).int(g.field).int(g.tx).int(g.ty).int(g.drop).int(g.until).int(g.tries);
    h.int(e.cargo).str(e.cargoKind);
    if (!e.build) h.int(-1);
    else h.int(e.build.progress).int(e.build.total).int(e.build.paid[0]).int(e.build.paid[1]);
    if (!e.queue) h.int(-1);
    else {
      h.int(e.queue.length);
      for (const q of e.queue) h.str(q.unit).int(q.paid[0]).int(q.paid[1]).int(q.done).bool(q.started).bool(q.blocked);
    }
    if (!e.rally) h.int(-1);
    else h.int(e.rally.x).int(e.rally.y).int(e.rally.target);
    if (!e.buildOrder) h.int(-1);
    else h.str(e.buildOrder.type).int(e.buildOrder.paid[0]).int(e.buildOrder.paid[1]);
    if (!e.job) h.int(-1);
    else h.str(e.job.kind).int(e.job.target).int(e.job.tries).int(e.job.next);
    if (!e.morph) h.int(-1);
    else h.str(e.morph.into).int(e.morph.until).int(e.morph.paid[0]).int(e.morph.paid[1]).int(e.morph.extra);
    const mv = e.mv;
    if (!mv) h.int(-1);
    else {
      h.int(mv.gx).int(mv.gy).int(mv.i).bool(mv.waiting).int(mv.best).int(mv.since).int(mv.stalls).int(mv.grp).int(mv.path.length);
      for (const v of mv.path) h.int(v);
    }
  }
  h.int(world.pathQueue.length);
  for (const r of world.pathQueue) h.int(r.id).int(r.prio).int(r.t);
  h.int(world.nextGroup).int(world.groupPaths.length);
  for (const gp of world.groupPaths) {
    h.int(gp.grp).int(gp.size).int(gp.t).int(gp.tiles.length);
    for (const v of gp.tiles) h.int(v);
  }
  return h.hex();
}

/** Problems that must never happen; tests call this after every tick. */
export function checkInvariants(world: World, ctx: SimContext): string[] {
  const { catalog, nav } = ctx;
  const out: string[] = [];
  let lastId = 0;
  const supply = new Map<number, number>();
  for (const e of world.entities) {
    if (e.id <= lastId) out.push(`entity ${e.id}: ids not strictly increasing`);
    lastId = e.id;
    for (const k of ['x', 'y', 'hp', 'maxHp', 'bornTick', 'owner'] as const) if (!Number.isSafeInteger(e[k])) out.push(`entity ${e.id}: ${k} is not an integer`);
    if (e.x < 0 || e.y < 0 || e.x >= world.mapW || e.y >= world.mapH) out.push(`entity ${e.id}: outside the map`);
    if (e.hp <= 0 || e.hp > e.maxHp) out.push(`entity ${e.id}: hp ${e.hp}/${e.maxHp}`);
    if (e.owner < 0 || e.owner > world.players.length) out.push(`entity ${e.id}: owner ${e.owner}`);
    if (e.id >= world.nextId) out.push(`entity ${e.id}: id not below nextId`);
    if (!e.building) {
      if (e.owner > 0) supply.set(e.owner, (supply.get(e.owner) ?? 0) + (catalog.units.get(e.type)?.supply ?? 0));
      if (nav.blocked(Math.floor(e.x / 256), Math.floor(e.y / 256))) out.push(`entity ${e.id}: standing inside a wall or building`);
      if (e.mv) {
        if (e.order.kind !== 'move' && e.order.kind !== 'gather' && e.order.kind !== 'job') out.push(`entity ${e.id}: has a path but no move, gather or job order`);
        if (e.mv.path.length % 2 !== 0 || e.mv.i % 2 !== 0) out.push(`entity ${e.id}: malformed path`);
        const queued = world.pathQueue.some((r) => r.id === e.id);
        if (e.mv.waiting !== queued) out.push(`entity ${e.id}: waiting=${e.mv.waiting} but queued=${queued}`);
      }
    }
  }
  // economy: stocks and loads within bounds, every slot owned by a living harvester, and
  // every harvester holding exactly one slot of the target it works
  const holder = new Map<number, number>();
  for (const e of world.entities) {
    if (e.res) {
      const rd = catalog.resources.get(e.type);
      const bd = catalog.buildings.get(e.type);
      const max = rd ? rd.stock : 0;
      if (!Number.isSafeInteger(e.res.stock) || e.res.stock < 0 || e.res.stock > max) out.push(`entity ${e.id}: stock ${e.res.stock} of ${max}`);
      const want = rd ? rd.slots : (bd?.workSlots ?? 0);
      if (e.res.slots.length !== want) out.push(`entity ${e.id}: ${e.res.slots.length} slots, expected ${want}`);
      for (const id of e.res.slots) {
        if (id === 0) continue;
        const c = entityById(world, id);
        if (!c || !c.gather || c.gather.st !== 'harvest' || c.gather.target !== e.id) out.push(`entity ${e.id}: slot held by ${id}, which is not harvesting it`);
        if (holder.has(id)) out.push(`carrier ${id} holds two slots`);
        holder.set(id, e.id);
      }
      if (e.res.link !== 0) {
        const o = entityById(world, e.res.link);
        if (!o || !o.res || o.res.link !== e.id) out.push(`entity ${e.id}: link to ${e.res.link} is not mutual`);
        else if (isExtractor(ctx, e) === isExtractor(ctx, o)) out.push(`entity ${e.id}: link must join an extractor and a deposit`);
      }
    } else if (e.building && (catalog.resources.has(e.type) || isExtractor(ctx, e))) out.push(`entity ${e.id}: resource state missing`);
    if (!Number.isSafeInteger(e.cargo) || e.cargo < 0 || e.cargo > carryOf(ctx, e)) out.push(`entity ${e.id}: cargo ${e.cargo}`);
    if ((e.cargo > 0) !== (e.cargoKind !== '')) out.push(`entity ${e.id}: cargo ${e.cargo} of kind '${e.cargoKind}'`);
    if ((e.gather !== null) !== (e.order.kind === 'gather')) out.push(`entity ${e.id}: gather state and order disagree`);
    if (e.gather && carryOf(ctx, e) === 0) out.push(`entity ${e.id}: gathering without being a carrier`);
  }
  for (const e of world.entities) {
    if (e.gather?.st !== 'harvest') continue;
    const t = entityById(world, e.gather.target);
    if (t && holder.get(e.id) !== t.id) out.push(`carrier ${e.id}: harvesting ${t.id} without its slot`);
  }
  for (const e of world.entities) if (isCrystal(ctx, e) && e.res && e.res.field === 0) out.push(`crystal ${e.id}: no field`);

  // production and construction: reserved supply matches what is queued and morphing; queues
  // within bounds; growth within bounds; jobs and morphs agree with orders
  const reserved = new Map<number, number>();
  for (const e of world.entities) {
    const add = (n: number) => reserved.set(e.owner, (reserved.get(e.owner) ?? 0) + n);
    if (e.queue) {
      if (e.queue.length > QUEUE_MAX) out.push(`entity ${e.id}: queue of ${e.queue.length}`);
      for (const q of e.queue) {
        const u = catalog.units.get(q.unit);
        if (!u) {
          out.push(`entity ${e.id}: queue holds unknown ${q.unit}`);
          continue;
        }
        add(u.supply);
        if (q.done < 0 || q.done > u.trainTicks || (q.blocked && q.done < u.trainTicks) || (q.done > 0 && !q.started)) out.push(`entity ${e.id}: queue item ${q.unit} done ${q.done} started ${q.started} blocked ${q.blocked}`);
      }
    } else if (e.building && (catalog.buildings.get(e.type)?.produces.length ?? 0) > 0) out.push(`entity ${e.id}: production building without a queue`);
    if (e.morph) {
      add(e.morph.extra);
      if (e.order.kind !== 'morph') out.push(`entity ${e.id}: morphing without the order`);
    } else if (e.order.kind === 'morph') out.push(`entity ${e.id}: morph order without a morph`);
    if ((e.job !== null) !== (e.order.kind === 'job')) out.push(`entity ${e.id}: job and order disagree`);
    if (e.build && (e.build.progress < 0 || e.build.progress > e.build.total)) out.push(`entity ${e.id}: growth ${e.build.progress}/${e.build.total}`);
    if (e.buildOrder && catalog.factions.get(world.players[e.owner - 1]?.faction ?? 'wl')?.hq !== e.type) out.push(`entity ${e.id}: holds a building order but is not a lymph node`);
  }
  for (const p of world.players) {
    if (p.supplyReserved !== (reserved.get(p.id) ?? 0)) out.push(`player ${p.id}: supplyReserved ${p.supplyReserved} but queues and morphs hold ${reserved.get(p.id) ?? 0}`);
    if (p.supplyCap !== supplyCapOf(world, catalog, p.id)) out.push(`player ${p.id}: supplyCap ${p.supplyCap} out of date`);
  }
  for (const r of world.pathQueue) {
    const e = world.entities.find((x) => x.id === r.id);
    if (!e || !e.mv || !e.mv.waiting) out.push(`path request for ${r.id} without a waiting unit`);
  }
  for (const p of world.players) {
    if (p.basic < 0 || p.advanced < 0) out.push(`player ${p.id}: negative resources`);
    if (p.supplyUsed !== (supply.get(p.id) ?? 0)) out.push(`player ${p.id}: supplyUsed ${p.supplyUsed} but units need ${supply.get(p.id) ?? 0}`);
  }
  return out;
}
