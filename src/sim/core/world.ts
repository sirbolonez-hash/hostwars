// The authoritative world. Plain data only, so a snapshot is JSON and restores exactly.
// Entities stay sorted by id (ids only grow), which gives every system the same iteration order.

import type { Catalog } from '../content/catalog';
import type { FactionId } from '../content/types';
import { stampBuilding, type SimContext } from '../context';
import { SUB } from './fixed';
import { seedRng, type RngState } from './rng';

export const WORLD_VERSION = 3;
export const NEUTRAL = 0;

export interface Player {
  id: number; // 1-based; 0 is neutral
  faction: FactionId;
  team: number;
  basic: number;
  advanced: number;
  supplyUsed: number;
  supplyCap: number;
  defeated: boolean;
}

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'hold' }
  | { kind: 'gather' }; // details in Entity.gather

/**
 * Resource state. On a crystal: what is left and who works it. On a deposit (protein, iron):
 * what is left and the extractor on top. On an extractor: its work slots and the deposit below.
 */
export interface ResState {
  stock: number; // crystals and deposits; 0 on an extractor (its deposit holds the stock)
  field: number; // crystals: field from the map; 0 otherwise
  slots: number[]; // carrier per work slot, 0 = free; a deposit has none (its extractor does)
  link: number; // deposit ↔ extractor; 0 = none
}

export type GatherStage = 'toRes' | 'wait' | 'harvest' | 'toDrop' | 'unload';

/** A carrier's place in the gather cycle (architecture tab, section 4). */
export interface GatherState {
  st: GatherStage;
  target: number; // crystal or extractor worked; 0 = only returning cargo
  field: number; // field of the target, to find another crystal when it runs out
  tx: number; // where the target was (sub-tiles), for the same reason
  ty: number;
  drop: number; // dropoff for this trip; 0 = not chosen
  until: number; // tick a timed stage (harvest, unload) ends; tick a wait started
  tries: number; // failed approaches in a row
}

/** Runtime state of a unit that is travelling. */
export interface MoveState {
  gx: number; // goal centre, sub-tiles
  gy: number;
  path: number[]; // waypoints [x0, y0, x1, y1, ...] in sub-tiles
  i: number; // index of the next waypoint's x
  waiting: boolean; // path requested, not computed yet
  best: number; // closest distance to the goal in the current progress window
  since: number; // tick the window started
  stalls: number; // windows in a row without progress
  grp: number; // group order this move belongs to; 0 = sent alone
}

/** A path found for one member of a group order, offered to the others (saved with the world). */
export interface GroupPath {
  grp: number;
  size: number; // body size it was searched for
  tiles: number[]; // raw A* nodes [x0, y0, ...]
  t: number; // tick found
}

export interface PathRequest {
  id: number; // entity
  prio: 0 | 1; // 0 = player order, 1 = repath
  t: number; // tick queued
}

export interface Entity {
  id: number;
  type: string; // content id
  owner: number;
  x: number; // sub-tiles
  y: number;
  hp: number;
  maxHp: number;
  building: boolean;
  bornTick: number;
  order: Order;
  mv: MoveState | null;
  /** resources and extractors */
  res: ResState | null;
  /** carriers on a gather order */
  gather: GatherState | null;
  /** load a carrier holds; not money until unloaded, and lost if the carrier dies */
  cargo: number;
  cargoKind: '' | 'glucose' | 'protein' | 'iron';
}

export interface World {
  version: number;
  /** test match: dev commands allowed */
  dev: boolean;
  contentHash: string;
  map: string;
  tick: number;
  seed: number;
  rng: RngState;
  nextId: number;
  mapW: number; // sub-tiles
  mapH: number;
  players: Player[];
  entities: Entity[];
  pathQueue: PathRequest[];
  nextGroup: number;
  groupPaths: GroupPath[];
}

export interface MatchSetup {
  seed: number;
  map: string;
  dev?: boolean;
  players: { faction: FactionId; team: number; startTile: [number, number] }[];
}

export function createWorld(ctx: SimContext, setup: MatchSetup): World {
  const { catalog, map } = ctx;
  if (setup.map !== map.id) throw new Error(`setup is for map ${setup.map}, context has ${map.id}`);
  const world: World = {
    version: WORLD_VERSION,
    dev: setup.dev === true,
    contentHash: catalog.hash,
    map: map.id,
    tick: 0,
    seed: setup.seed >>> 0,
    rng: seedRng(setup.seed),
    nextId: 1,
    mapW: map.w * SUB,
    mapH: map.h * SUB,
    players: [],
    entities: [],
    pathQueue: [],
    nextGroup: 1,
    groupPaths: [],
  };
  setup.players.forEach((p, i) => {
    const f = catalog.factions.get(p.faction);
    if (!f) throw new Error(`unknown faction ${p.faction}`);
    world.players.push({ id: i + 1, faction: p.faction, team: p.team, basic: f.basic, advanced: f.advanced, supplyUsed: 0, supplyCap: 0, defeated: false });
  });
  for (const r of map.resources) {
    const [fw, fh] = catalog.footprints.get(r.type)!;
    spawnResource(world, ctx, r.type, r.tile[0] * SUB + fw * (SUB / 2), r.tile[1] * SUB + fh * (SUB / 2), r.field);
  }
  setup.players.forEach((p, i) => {
    const f = catalog.factions.get(p.faction)!;
    const owner = i + 1;
    const [sx, sy] = p.startTile;
    const hq = catalog.buildings.get(f.hq)!;
    spawnBuilding(world, ctx, f.hq, owner, sx * SUB + hq.footprint[0] * (SUB / 2), sy * SUB + hq.footprint[1] * (SUB / 2));
    // starting units in rows of six below the HQ, in a fixed order
    let k = 0;
    for (const s of f.start) {
      for (let n = 0; n < s.count; n++, k++) {
        const col = k % 6;
        const row = Math.floor(k / 6);
        spawnUnit(world, catalog, s.unit, owner, sx * SUB + 128 + col * SUB, (sy + hq.footprint[1]) * SUB + 128 + row * SUB);
      }
    }
  });
  return world;
}

function supplyCapOf(world: World, catalog: Catalog, owner: number): number {
  const f = catalog.factions.get(world.players[owner - 1]!.faction)!;
  let cap = 0;
  for (const e of world.entities) if (e.owner === owner && e.building) cap += catalog.buildings.get(e.type)?.supplyProvided ?? 0;
  return Math.min(cap, f.supplyCap);
}

export function spawnBuilding(world: World, ctx: SimContext, type: string, owner: number, x: number, y: number): Entity {
  const def = ctx.catalog.buildings.get(type);
  if (!def) throw new Error(`unknown building ${type}`);
  const e: Entity = {
    id: world.nextId++, type, owner, x: Math.trunc(x), y: Math.trunc(y), hp: def.hp, maxHp: def.hp,
    building: true, bornTick: world.tick, order: { kind: 'idle' }, mv: null,
    res: def.workSlots > 0 ? { stock: 0, field: 0, slots: new Array<number>(def.workSlots).fill(0), link: 0 } : null,
    gather: null, cargo: 0, cargoKind: '',
  };
  world.entities.push(e);
  stampBuilding(ctx, type, e.x, e.y, 1);
  if (owner !== NEUTRAL) world.players[owner - 1]!.supplyCap = supplyCapOf(world, ctx.catalog, owner);
  return e;
}

/** A neutral crystal or deposit. Resources block movement like buildings and cannot be damaged yet. */
export function spawnResource(world: World, ctx: SimContext, type: string, x: number, y: number, field: number): Entity {
  const def = ctx.catalog.resources.get(type);
  if (!def) throw new Error(`unknown resource ${type}`);
  const e: Entity = {
    id: world.nextId++, type, owner: NEUTRAL, x: Math.trunc(x), y: Math.trunc(y), hp: 1, maxHp: 1,
    building: true, bornTick: world.tick, order: { kind: 'idle' }, mv: null,
    res: { stock: def.stock, field: def.kind === 'glucose' ? field : 0, slots: new Array<number>(def.slots).fill(0), link: 0 },
    gather: null, cargo: 0, cargoKind: '',
  };
  world.entities.push(e);
  stampBuilding(ctx, type, e.x, e.y, 1);
  return e;
}

export function spawnUnit(world: World, catalog: Catalog, type: string, owner: number, x: number, y: number): Entity {
  const def = catalog.units.get(type);
  if (!def) throw new Error(`unknown unit ${type}`);
  const e: Entity = {
    id: world.nextId++, type, owner,
    x: clampInt(Math.trunc(x), 0, world.mapW - 1), y: clampInt(Math.trunc(y), 0, world.mapH - 1),
    hp: def.hp, maxHp: def.hp, building: false, bornTick: world.tick, order: { kind: 'idle' }, mv: null,
    res: null, gather: null, cargo: 0, cargoKind: '',
  };
  world.entities.push(e);
  if (owner !== NEUTRAL) world.players[owner - 1]!.supplyUsed += def.supply;
  return e;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Removes an entity and gives back what it held. Call only from the death phase. */
export function removeEntity(world: World, ctx: SimContext, id: number): Entity | undefined {
  const i = world.entities.findIndex((e) => e.id === id);
  if (i < 0) return undefined;
  const [e] = world.entities.splice(i, 1);
  if (!e) return undefined;
  if (e.building) stampBuilding(ctx, e.type, e.x, e.y, -1);
  world.pathQueue = world.pathQueue.filter((r) => r.id !== id);
  // every reservation it held, and every link to it, is released here
  for (const o of world.entities) {
    if (!o.res) continue;
    for (let k = 0; k < o.res.slots.length; k++) if (o.res.slots[k] === id) o.res.slots[k] = 0;
    if (o.res.link === id) o.res.link = 0;
  }
  if (e.owner !== NEUTRAL) {
    const p = world.players[e.owner - 1]!;
    if (e.building) p.supplyCap = supplyCapOf(world, ctx.catalog, e.owner);
    else p.supplyUsed -= ctx.catalog.units.get(e.type)?.supply ?? 0;
  }
  return e;
}

/** Entities stay sorted by id, so lookups by id are a binary search. */
export function entityById(world: World, id: number): Entity | undefined {
  const a = world.entities;
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = a[mid]!;
    if (e.id === id) return e;
    if (e.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function snapshot(world: World): string {
  return JSON.stringify(world);
}

export function restore(text: string): World {
  const w = JSON.parse(text) as World;
  if (w.version !== WORLD_VERSION) throw new Error(`snapshot version ${w.version}, expected ${WORLD_VERSION}`);
  return w;
}
