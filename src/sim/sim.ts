// One simulation tick, in the order written in the architecture (tab 2, section 3).
// Phases that later gates fill in are listed in place so the order never shifts.

import { validate, type CommandEnvelope, type Rejection } from './commands/commands';
import type { SimContext } from './context';
import { isqrt } from './core/fixed';
import { Hasher } from './core/hash';
import { removeEntity, spawnUnit, type Entity, type World } from './core/world';
import { centreOf, CLASS_SIZE } from './navigation/grid';
import { nearestPassable } from './navigation/slots';
import { clearMove, issueMove, moveUnits, processPathQueue, type MoveEvent } from './navigation/movement';

export type SimEvent =
  | { tick: number; type: 'rejected'; rejection: Rejection }
  | { tick: number; type: 'arrived'; entity: number }
  | { tick: number; type: 'blocked'; entity: number }
  | { tick: number; type: 'died'; entity: number; entityType: string; owner: number; cause: 'lifespan' | 'damage' };

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
    const reason = env.tick !== tick ? 'late' : validate(world, env, index, (t) => catalog.units.has(t));
    if (reason) {
      events.push({ tick, type: 'rejected', rejection: { player: env.player, seq: env.seq, reason } });
      continue;
    }
    applyCommand(world, ctx, env, index);
  }

  // 4. AI decisions are commands for a later tick; they enter through the queue (gate 6)

  // 5. path searches under the tick budget, then movement
  index = indexOf(world);
  const pathExpansions = processPathQueue(world, ctx, index);
  const moveEvents: MoveEvent[] = [];
  moveUnits(world, ctx, moveEvents);
  for (const m of moveEvents) events.push({ tick, ...m });

  // 6. spatial index and vision after movement                              (gate 5)
  // 7. economy: gathering, construction, production, research               (gate 3, 4)
  // 8. targeting, weapon cooldowns, firing                                  (gate 5)
  // 9. projectiles and hits: damage first, then healing                     (gate 5)

  // 10. death: lifespans and hit points; release supply, footprints and path requests
  const dying: { e: Entity; cause: 'lifespan' | 'damage' }[] = [];
  for (const e of world.entities) {
    if (e.hp <= 0) {
      dying.push({ e, cause: 'damage' });
      continue;
    }
    if (!e.building) {
      const life = catalog.units.get(e.type)?.lifespan ?? 0;
      if (life > 0 && tick - e.bornTick >= life) dying.push({ e, cause: 'lifespan' });
    }
  }
  for (const { e, cause } of dying) {
    removeEntity(world, ctx, e.id);
    events.push({ tick, type: 'died', entity: e.id, entityType: e.type, owner: e.owner, cause });
  }

  // 11. host monitor: inflammation, fever, pressure, saturation              (gate 7)
  // 12. mission triggers, victory check, events, hash
  world.tick = tick + 1;
  return { events, hash: hashWorld(world, ctx), stats: { pathExpansions } };
}

function applyCommand(world: World, ctx: SimContext, env: CommandEnvelope, index: Map<number, Entity>): void {
  const units = env.cmd.units.map((id) => index.get(id)).filter((e): e is Entity => e !== undefined);
  switch (env.cmd.type) {
    case 'MOVE':
      issueMove(world, ctx, units, env.cmd.x, env.cmd.y);
      break;
    case 'STOP':
      for (const e of units) {
        clearMove(world, e);
        e.order = { kind: 'idle' };
      }
      break;
    case 'HOLD':
      for (const e of units) {
        clearMove(world, e);
        e.order = { kind: 'hold' };
      }
      break;
    case 'DEV_SPAWN': {
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
}

/** Canonical hash of everything that affects the future of the match. */
export function hashWorld(world: World, ctx: SimContext): string {
  const h = new Hasher();
  h.str(world.contentHash).str(world.map).bool(world.dev).int(world.tick).int(world.seed).int(world.nextId).int(world.mapW).int(world.mapH);
  h.int(world.rng.a).int(world.rng.b).int(world.rng.c).int(world.rng.d);
  for (const p of world.players) {
    h.int(p.id).str(p.faction).int(p.team).int(p.basic).int(p.advanced).int(p.supplyUsed).int(p.supplyCap).bool(p.defeated);
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
    }
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
        if (e.order.kind !== 'move') out.push(`entity ${e.id}: has a path but no move order`);
        if (e.mv.path.length % 2 !== 0 || e.mv.i % 2 !== 0) out.push(`entity ${e.id}: malformed path`);
        const queued = world.pathQueue.some((r) => r.id === e.id);
        if (e.mv.waiting !== queued) out.push(`entity ${e.id}: waiting=${e.mv.waiting} but queued=${queued}`);
      }
    }
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
