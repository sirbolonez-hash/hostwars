// The authoritative world. Plain data only, so a snapshot is JSON and restores exactly.
// Entities stay sorted by id (ids only grow), which gives every system the same iteration order.

import type { Catalog } from '../content/catalog';
import type { FactionId } from '../content/types';
import { stampBuilding, type SimContext } from '../context';
import { SUB } from './fixed';
import { seedRng, type RngState } from './rng';

export const WORLD_VERSION = 6;
export const NEUTRAL = 0;

export interface Player {
  id: number; // 1-based; 0 is neutral
  faction: FactionId;
  team: number;
  basic: number;
  advanced: number;
  supplyUsed: number;
  /** supply held by queued units and morphs that have not finished */
  supplyReserved: number;
  supplyCap: number;
  defeated: boolean;
  /** antigen families processed at a lymph node, in the order they opened (the White Line's tier 2) */
  antigens: string[];
}

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'hold' }
  | { kind: 'gather' } // details in Entity.gather
  | { kind: 'job' } // a builder helping a building grow or repairing it; details in Entity.job
  | { kind: 'morph' } // turning into another unit; details in Entity.morph
  | { kind: 'attack'; target: number } // attack this one until it dies or is lost from sight
  | { kind: 'amove'; x: number; y: number }; // move there, fighting whatever comes in sight

/** An armed unit's or building's attack: target, windup and cooldown (architecture tab, section 6). */
export interface Combat {
  target: number; // 0 = none
  windupEnd: number; // tick the attack being wound up launches; -1 = none
  nextLaunch: number; // the earliest tick of the next launch: the cooldown runs from each launch
  engaged: boolean; // an idle unit fighting on its own: it keeps to `anchor`
  anchorX: number;
  anchorY: number;
  chased: number; // tick of the last chase path request
}

/** A launched attack on its way. Melee and arc attacks are projectiles that land on the tick they launch. */
export interface Projectile {
  id: number;
  owner: number;
  weapon: string;
  source: number;
  target: number;
  fromX: number;
  fromY: number;
  x: number; // last known target point
  y: number;
  launch: number;
  impact: number;
  /** the attacker's boost at launch, thousandths (IFN-γ for a macrophage near a helper) */
  power: number;
  /** the antigen family the attacker was trained against ('' = innate) */
  spec: string;
  /** IFN-γ: a macrophage helped by a CD4 can swallow capsules too */
  ifn: boolean;
}

/** What a player last saw of a building or resource that is not theirs. */
export interface Memory {
  id: number;
  type: string;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  growing: boolean;
  stock: number;
  tick: number; // when it was last seen
}

export interface Outcome {
  winnerTeam: number; // 0 = draw
  tick: number;
}

/** One unit in a production queue. Paid and its supply reserved when ordered. */
export interface QueueItem {
  unit: string;
  paid: [number, number];
  done: number; // ticks of training done
  started: boolean; // cancelling a started item refunds 75%
  blocked: boolean; // trained, waiting for a free exit
}

/** A building that is still growing (it stands on the map from the first tick). */
export interface BuildState {
  progress: number; // work done, in thousandths of a tick
  total: number; // buildTicks × 1000
  paid: [number, number];
}

/** Where new units go: a point, or an entity (a unit to join, a crystal to mine). */
export interface Rally {
  x: number;
  y: number;
  target: number; // 0 = the point
}

/** A building ordered (and paid) at a lymph node, waiting to be placed. */
export interface BuildOrder {
  type: string;
  paid: [number, number];
}

/**
 * A unit's errand: a builder helping a building grow or repairing it; a dendritic cell taking
 * a sample and carrying it home; a feeder walking to a site to become a building.
 */
export interface Job {
  kind: 'assist' | 'repair' | 'sample' | 'deliver' | 'build_at';
  target: number; // the building, the sampled enemy, the lymph node; 0 for build_at
  tries: number;
  next: number; // repair: tick of the next step; sample: tick sampling began (-1 = not yet)
  build: string; // build_at: the building
  tx: number; // build_at: its top-left tile
  ty: number;
  paid: [number, number]; // build_at: paid at the order, refunded if the site is lost
}

/** Turning into another unit (monocyte → macrophage), or splitting in two (`copy`: the Colony). */
export interface Morph {
  into: string;
  until: number;
  paid: [number, number];
  extra: number; // supply reserved on top of the unit's own
  copy: boolean; // true: a second unit of the same type appears; the first stays as it is
}

/** One antigen sample at a lymph node: processed for 30 s, then its family opens. */
export interface LabItem {
  family: string;
  until: number; // 0 = waiting its turn
}

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
  /** growing buildings */
  build: BuildState | null;
  /** production buildings: up to 5 units */
  queue: QueueItem[] | null;
  rally: Rally | null;
  /** lymph nodes: one building ordered and not yet placed */
  buildOrder: BuildOrder | null;
  /** builders at work */
  job: Job | null;
  morph: Morph | null;
  /** armed units and buildings */
  cb: Combat | null;
  /** a slow on it: speed is cut by `pct` thousandths until `until` */
  slow: { until: number; pct: number } | null;
  /** the last tick it attacked or was hit (the Colony splits only out of combat) */
  lastCombat: number;
  /** a dendritic cell's carried sample: an antigen family, or '' */
  sample: string;
  /** an acquired unit's specificity: the family it was trained against, or '' */
  spec: string;
  /** buildings: the tick they were finished (biofilm spreads from it) */
  doneTick: number;
  /** lymph nodes: samples being processed */
  lab: LabItem[] | null;
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
  projectiles: Projectile[];
  nextShot: number;
  /** per player (index = id − 1): explored tiles as a bitset of 32-bit words */
  explored: number[][];
  /** per player: what they last saw of buildings and resources not theirs */
  memory: Memory[][];
  outcome: Outcome | null;
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
    projectiles: [],
    nextShot: 1,
    explored: [],
    memory: [],
    outcome: null,
  };
  setup.players.forEach((p, i) => {
    const f = catalog.factions.get(p.faction);
    if (!f) throw new Error(`unknown faction ${p.faction}`);
    world.players.push({ id: i + 1, faction: p.faction, team: p.team, basic: f.basic, advanced: f.advanced, supplyUsed: 0, supplyReserved: 0, supplyCap: 0, defeated: false, antigens: [] });
    world.explored.push(new Array<number>(Math.ceil((map.w * map.h) / 32)).fill(0));
    world.memory.push([]);
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
    const base = spawnBuilding(world, ctx, f.hq, owner, sx * SUB + hq.footprint[0] * (SUB / 2), sy * SUB + hq.footprint[1] * (SUB / 2));
    base.doneTick = -1_000_000; // a starting base has long been there: its biofilm is fully spread
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

/** Supply cap: finished buildings only, never above the faction's cap. */
export function supplyCapOf(world: World, catalog: Catalog, owner: number): number {
  const f = catalog.factions.get(world.players[owner - 1]!.faction)!;
  let cap = 0;
  for (const e of world.entities) if (e.owner === owner && e.building && !e.build && e.hp > 0) cap += catalog.buildings.get(e.type)?.supplyProvided ?? 0;
  return Math.min(cap, f.supplyCap);
}

const BLANK = {
  gather: null, cargo: 0, cargoKind: '' as const, build: null, queue: null, rally: null, buildOrder: null, job: null, morph: null,
  cb: null, slow: null, lastCombat: -1_000_000, sample: '', spec: '', doneTick: 0, lab: null,
};

/** A fresh attack state for an armed entity. */
export function newCombat(): Combat {
  return { target: 0, windupEnd: -1, nextLaunch: 0, engaged: false, anchorX: 0, anchorY: 0, chased: -1000 };
}

/** Hit points a growing building has from growth alone at `progress`: 10% at the start, all at the end. */
export function growthHp(maxHp: number, progress: number, total: number): number {
  const base = Math.max(1, Math.floor(maxHp / 10));
  return total <= 0 ? maxHp : base + Math.floor(((maxHp - base) * Math.min(progress, total)) / total);
}

/** A building; `paid` makes it start growing from 10% hit points (placed by a player), otherwise it stands finished. */
export function spawnBuilding(world: World, ctx: SimContext, type: string, owner: number, x: number, y: number, paid?: [number, number]): Entity {
  const def = ctx.catalog.buildings.get(type);
  if (!def) throw new Error(`unknown building ${type}`);
  const grows = paid !== undefined && def.buildTicks > 0;
  const total = def.buildTicks * 1000;
  const e: Entity = {
    id: world.nextId++, type, owner, x: Math.trunc(x), y: Math.trunc(y), hp: grows ? growthHp(def.hp, 0, total) : def.hp, maxHp: def.hp,
    building: true, bornTick: world.tick, order: { kind: 'idle' }, mv: null,
    res: def.workSlots > 0 ? { stock: 0, field: 0, slots: new Array<number>(def.workSlots).fill(0), link: 0 } : null,
    ...BLANK,
    build: grows ? { progress: 0, total, paid: [...paid] } : null,
    queue: def.produces.length > 0 ? [] : null,
    cb: def.weapon ? newCombat() : null,
    doneTick: world.tick,
    // a lymph node that orders buildings also processes antigen samples
    lab: ctx.catalog.factions.get(world.players[owner - 1]?.faction ?? 'wl')?.hq === type && ctx.catalog.factions.get(world.players[owner - 1]!.faction)!.construction === 'order' ? [] : null,
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
    ...BLANK,
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
    res: null,
    ...BLANK,
    cb: def.weapon ? newCombat() : null,
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
    // supply held for its queue or its morph goes back (refunds are settled before this, in the death phase)
    for (const q of e.queue ?? []) p.supplyReserved -= ctx.catalog.units.get(q.unit)?.supply ?? 0;
    if (e.morph) p.supplyReserved -= e.morph.extra;
  }
  // nobody keeps a rally on it, or aims at it
  for (const o of world.entities) {
    if (o.rally && o.rally.target === id) o.rally = { x: o.rally.x, y: o.rally.y, target: 0 };
    if (o.cb && o.cb.target === id) {
      o.cb.target = 0;
      o.cb.windupEnd = -1;
    }
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
