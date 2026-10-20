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
  const errors = validateMap(map);
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

export function footprintOrigin(ctx: SimContext, type: string, x: number, y: number): [number, number, number, number] {
  const def = ctx.catalog.buildings.get(type)!;
  const [fw, fh] = def.footprint;
  return [Math.floor((x - fw * 128) / 256), Math.floor((y - fh * 128) / 256), fw, fh];
}

export function stampBuilding(ctx: SimContext, type: string, x: number, y: number, delta: 1 | -1): void {
  const [tx, ty, fw, fh] = footprintOrigin(ctx, type, x, y);
  ctx.nav.stampFootprint(tx, ty, fw, fh, delta);
}
