// Missions (architecture tab: "mission triggers", phase 12): objectives, triggers and actions
// read from content/missions/*.json. Everything a mission does goes through here, inside the
// tick, so a mission is as deterministic, saveable and replayable as a skirmish.
//
// The host's monitor runs in every mission; a mission fails when the patient is lost (a
// cytokine storm, shock), when the tissue falls below the mission's minimum, or when a hero
// falls; it is won when a trigger says so (usually once every objective is done).

import type { SimContext } from '../context';
import { SUB } from '../core/fixed';
import { createWorld, spawnBuilding, spawnUnit, type Entity, type MatchSetup, type MissionState, type World } from '../core/world';
import type { MissionAction, MissionCond, MissionDef } from '../content/types';
import { centreOf, CLASS_SIZE } from '../navigation/grid';
import { travelTo } from '../navigation/movement';
import { nearestPassable } from '../navigation/slots';
import { newHost, tierOf, tissueOf } from '../host/host';

export type MissionEvent =
  | { type: 'mission_say'; speaker: string; text: string }
  | { type: 'objective'; id: string; state: 'active' | 'done' | 'failed' }
  | { type: 'mission_over'; won: boolean; reason: string };

/** Sets a mission up on a world made with `setup.mission`: host, places, objectives. */
export function initMission(world: World, ctx: SimContext, def: MissionDef): void {
  const p1 = world.players[0]!;
  const p2 = world.players[1]!;
  p1.basic = def.player.basic;
  p1.advanced = def.player.advanced;
  p2.basic = def.enemy.basic;
  p2.advanced = def.enemy.advanced;
  world.host = newHost();
  for (const [tx, ty] of def.host.cells) {
    const c = spawnBuilding(world, ctx, 'bld_neu_epithelial', 0, tx * SUB + SUB / 2, ty * SUB + SUB / 2);
    c.doneTick = -1_000_000;
    world.host.tissueMax += c.maxHp;
  }
  for (const p of def.place) {
    for (const e of place(world, ctx, p.owner, p.type, p.at, p.n ?? 1, p.tag ?? '', null)) {
      if (p.hp !== undefined) {
        e.hp = p.hp;
        e.maxHp = p.hp;
      }
    }
  }
  const objectives: MissionState['objectives'] = {};
  for (const o of def.objectives) objectives[o.id] = o.hidden ? 'hidden' : 'active';
  world.mission = { id: def.id, objectives, fired: {}, since: {}, stopped: [], gate: 0, made: {} };
}

/** Puts `n` of a unit around a tile, or a building with its top-left tile there. */
function place(world: World, ctx: SimContext, owner: number, type: string, at: [number, number], n: number, tag: string, go: [number, number] | null): Entity[] {
  const made: Entity[] = [];
  const b = ctx.catalog.buildings.get(type);
  if (b) {
    const [fw, fh] = b.footprint;
    const e = spawnBuilding(world, ctx, type, owner, at[0] * SUB + fw * (SUB / 2), at[1] * SUB + fh * (SUB / 2));
    e.doneTick = -1_000_000; // standing from the start: biofilm fully spread
    e.tag = tag;
    made.push(e);
    return made;
  }
  const u = ctx.catalog.units.get(type)!;
  const size = CLASS_SIZE[u.navClass];
  for (let k = 0; k < n; k++) {
    // a small block around the tile, each body on the nearest open spot
    const dx = (k % 3) - 1;
    const dy = (Math.floor(k / 3) % 3) - 1;
    const node = nearestPassable(ctx.nav, at[0] + dx, at[1] + dy, size) ?? [at[0], at[1]];
    const [x, y] = centreOf(node[0], node[1], size);
    const e = spawnUnit(world, ctx.catalog, type, owner, x, y);
    e.tag = tag;
    if (go) {
      const gx = go[0] * SUB + SUB / 2;
      const gy = go[1] * SUB + SUB / 2;
      e.order = { kind: 'amove', x: gx, y: gy };
      travelTo(world, ctx, e, gx, gy);
    }
    made.push(e);
  }
  return made;
}

function inRect(e: Entity, r: [number, number, number, number]): boolean {
  const tx = Math.floor(e.x / SUB);
  const ty = Math.floor(e.y / SUB);
  return tx >= r[0] && tx < r[0] + r[2] && ty >= r[1] && ty < r[1] + r[3];
}

function holds(world: World, ctx: SimContext, m: MissionState, c: MissionCond): boolean {
  switch (c.t) {
    case 'time':
      return world.tick >= c.at;
    case 'objective':
      return m.objectives[c.id] === c.is;
    case 'units_in': {
      let n = 0;
      for (const e of world.entities) {
        if (e.building || e.hp <= 0 || e.owner !== c.owner || !inRect(e, c.rect)) continue;
        if (c.type && e.type !== c.type) continue;
        if (c.role && ctx.catalog.units.get(e.type)?.role !== c.role) continue;
        n++;
      }
      return n >= c.n;
    }
    case 'none_tagged':
      return !world.entities.some((e) => e.tag === c.tag && e.hp > 0);
    case 'tagged':
      return world.entities.some((e) => e.tag === c.tag && e.hp > 0);
    case 'infl': {
      const v = world.host?.infl ?? 0;
      return (c.above === undefined || v > c.above) && (c.below === undefined || v < c.below);
    }
    case 'count': {
      let n = 0;
      for (const e of world.entities) if (e.owner === c.owner && e.type === c.type && e.hp > 0 && !e.build) n++;
      return n >= c.n;
    }
    case 'made':
      return (m.made[`${c.owner}:${c.type}`] ?? 0) >= c.n;
    case 'antigen':
      return (world.players[c.owner - 1]?.antigens.length ?? 0) > 0;
    case 'no_army':
      return !world.entities.some((e) => e.owner === c.owner && e.hp > 0);
  }
}

function act(world: World, ctx: SimContext, def: MissionDef, m: MissionState, a: MissionAction, events: MissionEvent[]): void {
  switch (a.a) {
    case 'spawn': {
      if (a.at === 'gates') {
        // the next open exit gate (inflammation opens more of them)
        const open = def.gates.filter((g) => (world.host?.infl ?? 0) >= g.infl);
        if (open.length === 0) return;
        const g = open[m.gate % open.length]!;
        m.gate++;
        place(world, ctx, a.owner, a.type, g.at, a.n, a.tag ?? '', a.go ?? null);
      } else place(world, ctx, a.owner, a.type, a.at, a.n, a.tag ?? '', a.go ?? null);
      return;
    }
    case 'objective':
      if (m.objectives[a.id] === a.state) return;
      m.objectives[a.id] = a.state;
      events.push({ type: 'objective', id: a.id, state: a.state });
      return;
    case 'say':
      events.push({ type: 'mission_say', speaker: a.speaker, text: a.text });
      return;
    case 'win':
      end(world, 1, 'won', events);
      return;
    case 'lose':
      end(world, 2, a.reason, events);
      return;
    case 'stop':
      if (!m.stopped.includes(a.trigger)) m.stopped.push(a.trigger);
      return;
    case 'grant': {
      const p = world.players[a.owner - 1]!;
      p.basic += a.basic;
      p.advanced += a.advanced;
      return;
    }
    case 'inflame':
      if (world.host) world.host.infl = Math.max(0, Math.min(100_000, world.host.infl + a.amount));
      return;
  }
}

function end(world: World, winnerTeam: number, reason: string, events: MissionEvent[]): void {
  if (world.outcome) return;
  world.outcome = { winnerTeam, tick: world.tick, reason };
  events.push({ type: 'mission_over', won: winnerTeam === 1, reason });
}

/**
 * Phase 12 in a mission: the patient's state first (lost patient, lost tissue, a fallen hero),
 * then every trigger in order.
 */
export function missionPhase(world: World, ctx: SimContext, def: MissionDef, hostLost: string, events: MissionEvent[]): void {
  const m = world.mission!;
  if (world.outcome) return;
  if (hostLost !== '') return end(world, 2, hostLost, events);
  if (world.host && world.host.tissueMax > 0 && tissueOf(world, ctx) < def.host.tissueMin) return end(world, 2, 'tissue', events);
  if (def.place.some((p) => p.tag === 'hero') && !world.entities.some((e) => e.tag === 'hero' && e.hp > 0)) return end(world, 2, 'hero', events);
  const fast = world.host !== null && tierOf(world.host.infl) === 1;
  for (const t of def.triggers) {
    if (world.outcome) return;
    if (m.stopped.includes(t.id)) continue;
    const last = m.fired[t.id];
    if (last !== undefined && t.every === undefined) continue;
    const ok = t.when.every((c) => holds(world, ctx, m, c));
    // conditions that must hold a while: since when they have
    const wait = t.hold ?? 0;
    if (!ok) {
      delete m.since[t.id];
      continue;
    }
    if (wait > 0) {
      if (m.since[t.id] === undefined) m.since[t.id] = world.tick;
      if (world.tick - m.since[t.id]! < wait) continue;
    }
    if (last !== undefined) {
      const every = t.fast && fast ? Math.floor((t.every! * 3) / 4) : t.every!;
      if (world.tick - last < every) continue;
    }
    m.fired[t.id] = world.tick;
    for (const a of t.do) act(world, ctx, def, m, a, events);
  }
}

/** The match setup for a mission: the player as player 1, the enemy as player 2. */
export function missionSetup(ctx: SimContext, seed: number): MatchSetup {
  const def = ctx.mission!;
  return {
    seed,
    map: def.map,
    mission: def.id,
    players: [
      { faction: def.player.faction, team: 1, startTile: ctx.map.starts[0]! },
      { faction: def.enemy.faction, team: 2, startTile: ctx.map.starts[1]! },
    ],
  };
}

/** A new world for the mission in `ctx`, set up and ready for its first tick. */
export function startMission(ctx: SimContext, seed: number): World {
  const world = createWorld(ctx, missionSetup(ctx, seed));
  initMission(world, ctx, ctx.mission!);
  return world;
}
