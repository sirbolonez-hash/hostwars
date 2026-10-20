// Loads the content JSON shipped with the game. Bundled at build time, so the
// simulation never fetches anything mid-match.

import buildings from '../../../content/buildings/slice.json';
import factions from '../../../content/factions.json';
import arena from '../../../content/maps/arena.json';
import resources from '../../../content/resources/slice.json';
import units from '../../../content/units/slice.json';
import weapons from '../../../content/weapons/slice.json';
import { createContext, type SimContext } from '../context';
import { compileCatalog, type Catalog } from './catalog';
import type { ContentFiles, MapDef } from './types';

export const contentFiles = { units, buildings, weapons, resources, factions } as unknown as ContentFiles;
export const maps: Record<string, MapDef> = { arena: arena as unknown as MapDef };

export function loadCatalog(knownAssets?: Set<string>): Catalog {
  return compileCatalog(contentFiles, knownAssets);
}

export function loadMap(id: string): MapDef {
  const m = maps[id];
  if (!m) throw new Error(`unknown map ${id}`);
  return m;
}

/** A fresh context for a new match on `mapId`. */
export function newMatchContext(mapId: string, catalog = loadCatalog()): SimContext {
  return createContext(catalog, loadMap(mapId));
}
