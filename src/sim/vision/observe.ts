// What one player knows, as plain data: the only view of a match the AI gets (architecture
// tab, section 8: "the AI plays by exactly the same rules: the same commands, the same
// prices, the same fog").
//
// Own units and buildings are known in full. Enemies only while seen this tick; enemy
// buildings seen before are remembered with the tick they were last seen, as they were then.
// Resources likewise. Nothing here is a live reference into the world.

import { footprintOrigin, type SimContext } from '../context';
import { SUB } from '../core/fixed';
import type { World } from '../core/world';
import { canSee } from './vision';

export interface ObsEntity {
  id: number;
  type: string;
  owner: number;
  x: number; // sub-tiles
  y: number;
  hp: number;
  maxHp: number;
  building: boolean;
  growing: boolean;
  /** the tick it was seen (this tick for own and visible things) */
  seen: number;
}

export interface ObsOwn extends ObsEntity {
  order: 'idle' | 'move' | 'hold' | 'gather' | 'job' | 'morph' | 'attack' | 'amove';
  /** gather target (crystal or extractor), 0 = none */
  gathering: number;
  cargo: number;
  job: '' | 'assist' | 'repair' | 'sample' | 'deliver' | 'build_at';
  /** build_at: the building it walks to become */
  jobBuild: string;
  /** production queue, unit types in order */
  queue: string[];
  /** a lymph node's ordered, unplaced building ('' = none) */
  buildOrder: string;
  morphing: boolean;
  /** ticks since it last attacked or was hit */
  calm: number;
  spec: string;
  sample: string;
  /** samples waiting or in processing at a lymph node */
  lab: number;
  /** building: top-left tile and size */
  tx: number;
  ty: number;
  fw: number;
  fh: number;
}

export interface ObsResource {
  id: number;
  type: string;
  kind: string;
  x: number;
  y: number;
  stock: number;
  field: number;
  /** a deposit's extractor, or an extractor's deposit; 0 = none */
  link: number;
  /** work slots and how many are taken */
  slots: number;
  taken: number;
  tx: number;
  ty: number;
  fw: number;
  fh: number;
  seen: number;
}

export interface Observation {
  tick: number;
  player: number;
  team: number;
  faction: string;
  basic: number;
  advanced: number;
  supplyUsed: number;
  supplyReserved: number;
  supplyCap: number;
  antigens: string[];
  defeated: boolean;
  own: ObsOwn[];
  /** enemy units and buildings seen this tick */
  enemies: ObsEntity[];
  /** enemy buildings not seen this tick, as they were when last seen */
  remembered: ObsEntity[];
  resources: ObsResource[];
  /** every start position on the map (public: the HQ's top-left tile), and this player's */
  starts: [number, number][];
  myStart: [number, number];
  mapW: number; // tiles
  mapH: number;
  opponents: { player: number; faction: string; defeated: boolean }[];
}

/** Builds `player`'s observation. Call after a step: vision then describes this tick. */
export function observe(world: World, ctx: SimContext, player: number, myStart: [number, number]): Observation {
  const { catalog } = ctx;
  const p = world.players[player - 1]!;
  const tick = world.tick;
  const own: ObsOwn[] = [];
  const enemies: ObsEntity[] = [];
  const resources: ObsResource[] = [];
  const seenIds = new Set<number>();
  const fp = (type: string, x: number, y: number): [number, number, number, number] =>
    catalog.footprints.has(type) ? footprintOrigin(ctx, type, x, y) : [Math.floor(x / SUB), Math.floor(y / SUB), 1, 1];
  for (const e of world.entities) {
    if (e.hp <= 0) continue;
    const res = catalog.resources.get(e.type);
    if (res) {
      if (!canSee(ctx, player, e)) continue;
      seenIds.add(e.id);
      const [tx, ty, fw, fh] = fp(e.type, e.x, e.y);
      resources.push({ id: e.id, type: e.type, kind: res.kind, x: e.x, y: e.y, stock: e.res!.stock, field: e.res!.field, link: e.res!.link, slots: e.res!.slots.length, taken: e.res!.slots.filter((s) => s !== 0).length, tx, ty, fw, fh, seen: tick });
      continue;
    }
    if (e.owner === player) {
      const [tx, ty, fw, fh] = e.building ? fp(e.type, e.x, e.y) : [0, 0, 0, 0];
      own.push({
        id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, building: e.building, growing: e.build !== null, seen: tick,
        order: e.order.kind, gathering: e.gather?.target ?? 0, cargo: e.cargo, job: e.job?.kind ?? '', jobBuild: e.job?.build ?? '',
        queue: (e.queue ?? []).map((q) => q.unit), buildOrder: e.buildOrder?.type ?? '', morphing: e.morph !== null,
        calm: tick - e.lastCombat, spec: e.spec, sample: e.sample, lab: e.lab?.length ?? 0, tx, ty, fw, fh,
      });
      // an own extractor's work slots count as a resource to work
      if (e.res && e.building) {
        resources.push({ id: e.id, type: e.type, kind: catalog.buildings.get(e.type)?.onResource ?? '', x: e.x, y: e.y, stock: 0, field: 0, link: e.res.link, slots: e.res.slots.length, taken: e.res.slots.filter((s) => s !== 0).length, tx, ty, fw, fh, seen: tick });
      }
      continue;
    }
    if (e.owner === 0) continue;
    const ally = world.players[e.owner - 1]!.team === p.team;
    if (ally || !canSee(ctx, player, e)) continue;
    seenIds.add(e.id);
    enemies.push({ id: e.id, type: e.type, owner: e.owner, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, building: e.building, growing: e.build !== null, seen: tick });
  }
  const remembered: ObsEntity[] = [];
  for (const m of world.memory[player - 1] ?? []) {
    if (seenIds.has(m.id)) continue;
    const res = catalog.resources.get(m.type);
    if (res) {
      const [tx, ty, fw, fh] = fp(m.type, m.x, m.y);
      resources.push({ id: m.id, type: m.type, kind: res.kind, x: m.x, y: m.y, stock: m.stock, field: 0, link: 0, slots: 0, taken: 0, tx, ty, fw, fh, seen: m.tick });
      continue;
    }
    if (m.owner === 0 || world.players[m.owner - 1]?.team === p.team) continue;
    remembered.push({ id: m.id, type: m.type, owner: m.owner, x: m.x, y: m.y, hp: m.hp, maxHp: m.maxHp, building: true, growing: m.growing, seen: m.tick });
  }
  return {
    tick, player, team: p.team, faction: p.faction, basic: p.basic, advanced: p.advanced,
    supplyUsed: p.supplyUsed, supplyReserved: p.supplyReserved, supplyCap: p.supplyCap, antigens: [...p.antigens], defeated: p.defeated,
    own, enemies, remembered, resources,
    starts: ctx.map.starts.map((s) => [s[0], s[1]] as [number, number]), myStart,
    mapW: ctx.map.w, mapH: ctx.map.h,
    opponents: world.players.filter((o) => o.team !== p.team).map((o) => ({ player: o.id, faction: o.faction, defeated: o.defeated })),
  };
}
