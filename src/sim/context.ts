// What a match needs besides its world state: content, the map, and the navigation
// grid derived from both. The grid is not saved; it is rebuilt from the map and the
// world's buildings, so a loaded save gets exactly the grid it was saved with.

import type { Catalog } from './content/catalog';
import type { MapDef } from './content/types';
import type { World } from './core/world';
import { AStar } from './navigation/astar';
import { NavGrid, validateMap } from './navigation/grid';

export interface SimContext {
  catalog: Catalog;
  map: MapDef;
  nav: NavGrid;
  astar: AStar;
}

export function createContext(catalog: Catalog, map: MapDef): SimContext {
  const errors = [...validateMap(map), ...validateMapResources(map, catalog)];
  if (errors.length) throw new Error('map invalid:\n  ' + errors.join('\n  '));
  const nav = new NavGrid(map);
  return { catalog, map, nav, astar: new AStar(nav) };
}

/** Context for a loaded world: fresh grid with every building's footprint stamped. */
export function contextForWorld(catalog: Catalog, map: MapDef, world: World): SimContext {
  if (world.map !== map.id) throw new Error(`world is on map ${world.map}, not ${map.id}`);
  const ctx = createContext(catalog, map);
  for (const e of world.entities) if (e.building) stampBuilding(ctx, e.type, e.x, e.y, 1);
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
