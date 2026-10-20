// What a match needs besides its world state: content, the map, and the navigation
// grid derived from both. The grid is not saved; it is rebuilt from the map and the
// world's buildings, so a loaded save gets exactly the grid it was saved with.

import type { Catalog } from './content/catalog';
import type { MapDef, MissionDef } from './content/types';
import type { World } from './core/world';
import { AStar } from './navigation/astar';
import { NavGrid, validateMap } from './navigation/grid';
import { computeVision, Vision } from './vision/vision';
import { Biofilm, computeBiofilm } from './colony/biofilm';

export interface SimContext {
  catalog: Catalog;
  map: MapDef;
  nav: NavGrid;
  astar: AStar;
  /** who sees what this tick: derived from the world every tick, never saved */
  vision: Vision;
  /** the Colony's ground this tick: derived from its cores every tick, never saved */
  biofilm: Biofilm;
  /** the map's special zones: kind → 1 on each tile of that kind */
  zones: Map<string, Uint8Array>;
  /** pus on each tile this tick: derived from the world's pus every tick, never saved */
  pus: Uint8Array;
  /** the mission being played (null in a skirmish) */
  mission: MissionDef | null;
}

export function createContext(catalog: Catalog, map: MapDef, mission: MissionDef | null = null): SimContext {
  const errors = [...validateMap(map), ...validateMapResources(map, catalog)];
  if (errors.length) throw new Error('map invalid:\n  ' + errors.join('\n  '));
  const nav = new NavGrid(map);
  const zones = new Map<string, Uint8Array>();
  for (const z of map.zones ?? []) {
    const g = zones.get(z.kind) ?? new Uint8Array(map.w * map.h);
    for (const i of z.tiles) g[i] = 1;
    zones.set(z.kind, g);
  }
  return { catalog, map, nav, astar: new AStar(nav), vision: new Vision(map.w, map.h), biofilm: new Biofilm(map.w, map.h), zones, pus: new Uint8Array(map.w * map.h), mission };
}

/** Context for a loaded world: fresh grid with every building's footprint stamped. */
export function contextForWorld(catalog: Catalog, map: MapDef, world: World, mission: MissionDef | null = null): SimContext {
  if (world.map !== map.id) throw new Error(`world is on map ${world.map}, not ${map.id}`);
  if ((world.mission?.id ?? null) !== (mission?.id ?? null)) throw new Error(`world is in mission ${world.mission?.id ?? 'none'}, not ${mission?.id ?? 'none'}`);
  const ctx = createContext(catalog, map, mission);
  for (const p of world.pus) ctx.pus[p.i] = 1;
  for (const e of world.entities) if (e.building) stampBuilding(ctx, e.type, e.x, e.y, 1);
  // derived layers, so a screen or an AI looking before the first tick sees the loaded match
  computeBiofilm(world, ctx);
  computeVision(world, ctx, false);
  return ctx;
}

/** Resources on the map must be known, inside it, on open ground, apart, and clear of the start areas. */
export function validateMapResources(map: MapDef, catalog: Catalog): string[] {
  const e: string[] = [];
  const nav = new NavGrid(map);
  const taken = new Set<number>();
  const fields = new Set(map.fields.map((f) => f.id));
  for (const f of map.fields) if (!Number.isInteger(f.id) || f.id < 1) e.push(`map ${map.id}: field ids start at 1 (got ${f.id})`);
  map.resources.forEach((r, k) => {
    const def = catalog.resources.get(r.type);
    if (!def) {
      e.push(`map ${map.id}: resource ${k} has unknown type ${r.type}`);
      return;
    }
    if (def.kind === 'glucose' && !fields.has(r.field)) e.push(`map ${map.id}: crystal ${k} is in field ${r.field}, which has no name`);
    if (def.kind !== 'glucose' && r.field !== 0) e.push(`map ${map.id}: deposit ${k} must be in field 0`);
    const [fw, fh] = def.footprint;
    for (let y = r.tile[1]; y < r.tile[1] + fh; y++) {
      for (let x = r.tile[0]; x < r.tile[0] + fw; x++) {
        if (nav.blocked(x, y)) e.push(`map ${map.id}: resource ${k} on a wall or outside at (${x}, ${y})`);
        if (taken.has(y * map.w + x)) e.push(`map ${map.id}: resource ${k} overlaps another at (${x}, ${y})`);
        taken.add(y * map.w + x);
        for (const [sx, sy] of map.starts) if (x >= sx && x < sx + 6 && y >= sy && y < sy + 6) e.push(`map ${map.id}: resource ${k} inside a start area`);
      }
    }
  });
  return e;
}

export function footprintOrigin(ctx: SimContext, type: string, x: number, y: number): [number, number, number, number] {
  const [fw, fh] = ctx.catalog.footprints.get(type)!;
  return [Math.floor((x - fw * 128) / 256), Math.floor((y - fh * 128) / 256), fw, fh];
}

export function stampBuilding(ctx: SimContext, type: string, x: number, y: number, delta: 1 | -1): void {
  const [tx, ty, fw, fh] = footprintOrigin(ctx, type, x, y);
  ctx.nav.stampFootprint(tx, ty, fw, fh, delta);
}
