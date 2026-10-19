// The authoritative world. Plain data only, so a snapshot is JSON and restores exactly.
// Entities stay sorted by id (ids only grow), which gives every system the same iteration order.

import type { Catalog } from '../content/catalog';
import type { FactionId } from '../content/types';
import { SUB } from './fixed';
import { seedRng, type RngState } from './rng';

export const WORLD_VERSION = 1;
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
  | { kind: 'hold' };

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
}

export interface World {
  version: number;
  contentHash: string;
  tick: number;
  seed: number;
  rng: RngState;
  nextId: number;
  mapW: number; // sub-tiles
  mapH: number;
  players: Player[];
  entities: Entity[];
}

export interface MatchSetup {
  seed: number;
  mapTiles: [number, number];
  players: { faction: FactionId; team: number; startTile: [number, number] }[];
}

export function createWorld(catalog: Catalog, setup: MatchSetup): World {
  const [tw, th] = setup.mapTiles;
  const world: World = {
    version: WORLD_VERSION,
    contentHash: catalog.hash,
    tick: 0,
    seed: setup.seed >>> 0,
    rng: seedRng(setup.seed),
    nextId: 1,
    mapW: tw * SUB,
    mapH: th * SUB,
    players: [],
    entities: [],
  };
  setup.players.forEach((p, i) => {
    const f = catalog.factions.get(p.faction);
    if (!f) throw new Error(`unknown faction ${p.faction}`);
    world.players.push({ id: i + 1, faction: p.faction, team: p.team, basic: f.basic, advanced: f.advanced, supplyUsed: 0, supplyCap: 0, defeated: false });
  });
  setup.players.forEach((p, i) => {
    const f = catalog.factions.get(p.faction)!;
    const owner = i + 1;
    const [sx, sy] = p.startTile;
    const hq = catalog.buildings.get(f.hq)!;
    spawnBuilding(world, catalog, f.hq, owner, sx * SUB + hq.footprint[0] * (SUB / 2), sy * SUB + hq.footprint[1] * (SUB / 2));
    // starting units on a ring below the HQ, in a fixed order
    let k = 0;
    for (const s of f.start) {
      for (let n = 0; n < s.count; n++, k++) {
        const col = k % 6;
        const row = Math.floor(k / 6);
        spawnUnit(world, catalog, s.unit, owner, sx * SUB + 64 + col * 192, (sy + hq.footprint[1]) * SUB + 128 + row * 192);
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

export function spawnBuilding(world: World, catalog: Catalog, type: string, owner: number, x: number, y: number): Entity {
  const def = catalog.buildings.get(type);
  if (!def) throw new Error(`unknown building ${type}`);
  const e: Entity = { id: world.nextId++, type, owner, x: Math.trunc(x), y: Math.trunc(y), hp: def.hp, maxHp: def.hp, building: true, bornTick: world.tick, order: { kind: 'idle' } };
  world.entities.push(e);
  if (owner !== NEUTRAL) world.players[owner - 1]!.supplyCap = supplyCapOf(world, catalog, owner);
  return e;
}

export function spawnUnit(world: World, catalog: Catalog, type: string, owner: number, x: number, y: number): Entity {
  const def = catalog.units.get(type);
  if (!def) throw new Error(`unknown unit ${type}`);
  const e: Entity = {
    id: world.nextId++, type, owner,
    x: clampInt(Math.trunc(x), 0, world.mapW - 1), y: clampInt(Math.trunc(y), 0, world.mapH - 1),
    hp: def.hp, maxHp: def.hp, building: false, bornTick: world.tick, order: { kind: 'idle' },
  };
  world.entities.push(e);
  if (owner !== NEUTRAL) world.players[owner - 1]!.supplyUsed += def.supply;
  return e;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Removes an entity and gives back what it held. Call only from the death phase. */
export function removeEntity(world: World, catalog: Catalog, id: number): Entity | undefined {
  const i = world.entities.findIndex((e) => e.id === id);
  if (i < 0) return undefined;
  const [e] = world.entities.splice(i, 1);
  if (!e) return undefined;
  if (e.owner !== NEUTRAL) {
    const p = world.players[e.owner - 1]!;
    if (e.building) p.supplyCap = supplyCapOf(world, catalog, e.owner);
    else p.supplyUsed -= catalog.units.get(e.type)?.supply ?? 0;
  }
  return e;
}

export function snapshot(world: World): string {
  return JSON.stringify(world);
}

export function restore(text: string): World {
  const w = JSON.parse(text) as World;
  if (w.version !== WORLD_VERSION) throw new Error(`snapshot version ${w.version}, expected ${WORLD_VERSION}`);
  return w;
}
