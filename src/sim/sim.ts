// One simulation tick, in the order written in the architecture (tab 2, section 3).
// Phases that later gates fill in are listed in place so the order never shifts.

import type { Catalog } from './content/catalog';
import { validate, type CommandEnvelope, type Rejection } from './commands/commands';
import { isqrt } from './core/fixed';
import { Hasher } from './core/hash';
import { removeEntity, type Entity, type World } from './core/world';

export type SimEvent =
  | { tick: number; type: 'rejected'; rejection: Rejection }
  | { tick: number; type: 'arrived'; entity: number }
  | { tick: number; type: 'died'; entity: number; entityType: string; owner: number; cause: 'lifespan' | 'damage' };

export interface StepResult {
  events: SimEvent[];
  hash: string;
}

function indexOf(world: World): Map<number, Entity> {
  const m = new Map<number, Entity>();
  for (const e of world.entities) m.set(e.id, e);
  return m;
}

/** Advances the world by one tick. `commands` must already be the ones scheduled for this tick. */
export function step(world: World, catalog: Catalog, commands: CommandEnvelope[]): StepResult {
  const events: SimEvent[] = [];
  const tick = world.tick;

  // 1. commands for this tick, in canonical order (the queue already sorted them)
  // 2. expire timed effects; refresh vision for the start of the tick        (gate 5)

  // 3. validate and apply commands
  const index = indexOf(world);
  for (const env of commands) {
    const reason = env.tick !== tick ? 'late' : validate(world, env, index);
    if (reason) {
      events.push({ tick, type: 'rejected', rejection: { player: env.player, seq: env.seq, reason } });
      continue;
    }
    applyCommand(env, index);
  }

  // 4. AI decisions are commands for a later tick; they enter through the queue (gate 6)

  // 5. pathfinding budget and movement (straight lines until gate 2 adds navigation)
  for (const e of world.entities) {
    if (e.building || e.order.kind !== 'move') continue;
    const def = catalog.units.get(e.type);
    if (!def) continue;
    const dx = e.order.x - e.x;
    const dy = e.order.y - e.y;
    const d = isqrt(dx * dx + dy * dy);
    if (d <= def.speed) {
      e.x = e.order.x;
      e.y = e.order.y;
      e.order = { kind: 'idle' };
      events.push({ tick, type: 'arrived', entity: e.id });
    } else {
      e.x += Math.trunc((dx * def.speed) / d);
      e.y += Math.trunc((dy * def.speed) / d);
    }
  }

  // 6. spatial index and vision after movement                              (gate 2, 5)
  // 7. economy: gathering, construction, production, research               (gate 3, 4)
  // 8. targeting, weapon cooldowns, firing                                  (gate 5)
  // 9. projectiles and hits: damage first, then healing                     (gate 5)

  // 10. death: lifespans and hit points; release supply and reservations
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
    removeEntity(world, catalog, e.id);
    events.push({ tick, type: 'died', entity: e.id, entityType: e.type, owner: e.owner, cause });
  }

  // 11. host monitor: inflammation, fever, pressure, saturation              (gate 7)
  // 12. mission triggers, victory check, events, hash
  world.tick = tick + 1;
  return { events, hash: hashWorld(world, catalog) };
}

function applyCommand(env: CommandEnvelope, index: Map<number, Entity>): void {
  for (const id of env.cmd.units) {
    const e = index.get(id);
    if (!e) continue; // died earlier; nothing to order
    switch (env.cmd.type) {
      case 'MOVE':
        e.order = { kind: 'move', x: env.cmd.x, y: env.cmd.y };
        break;
      case 'STOP':
        e.order = { kind: 'idle' };
        break;
      case 'HOLD':
        e.order = { kind: 'hold' };
        break;
    }
  }
}

/** Canonical hash of everything that affects the future of the match. */
export function hashWorld(world: World, catalog: Catalog): string {
  const h = new Hasher();
  h.str(world.contentHash).int(world.tick).int(world.seed).int(world.nextId).int(world.mapW).int(world.mapH);
  h.int(world.rng.a).int(world.rng.b).int(world.rng.c).int(world.rng.d);
  for (const p of world.players) {
    h.int(p.id).str(p.faction).int(p.team).int(p.basic).int(p.advanced).int(p.supplyUsed).int(p.supplyCap).bool(p.defeated);
  }
  h.int(world.entities.length);
  for (const e of world.entities) {
    h.int(e.id).int(catalog.typeIndex.get(e.type) ?? -1).int(e.owner).int(e.x).int(e.y).int(e.hp).int(e.maxHp).bool(e.building).int(e.bornTick);
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
  }
  return h.hex();
}

/** Problems that must never happen; tests call this after every tick. */
export function checkInvariants(world: World, catalog: Catalog): string[] {
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
    if (!e.building && e.owner > 0) supply.set(e.owner, (supply.get(e.owner) ?? 0) + (catalog.units.get(e.type)?.supply ?? 0));
  }
  for (const p of world.players) {
    if (p.basic < 0 || p.advanced < 0) out.push(`player ${p.id}: negative resources`);
    if (p.supplyUsed !== (supply.get(p.id) ?? 0)) out.push(`player ${p.id}: supplyUsed ${p.supplyUsed} but units need ${supply.get(p.id) ?? 0}`);
  }
  return out;
}
