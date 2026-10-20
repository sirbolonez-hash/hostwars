// Loads the content JSON shipped with the game. Bundled at build time, so the
// simulation never fetches anything mid-match.

import buildings from '../../../content/buildings/slice.json';
import factions from '../../../content/factions.json';
import arena from '../../../content/maps/arena.json';
import m01map from '../../../content/maps/m01.json';
import m02map from '../../../content/maps/m02.json';
import m03map from '../../../content/maps/m03.json';
import m01 from '../../../content/missions/m01.json';
import m02 from '../../../content/missions/m02.json';
import m03 from '../../../content/missions/m03.json';
import resources from '../../../content/resources/slice.json';
import units from '../../../content/units/slice.json';
import weapons from '../../../content/weapons/slice.json';
import { createContext, type SimContext } from '../context';
import { compileCatalog, type Catalog } from './catalog';
import type { ContentFiles, MapDef, MissionDef } from './types';

export const contentFiles = { units, buildings, weapons, resources, factions } as unknown as ContentFiles;
export const maps: Record<string, MapDef> = {
  arena: arena as unknown as MapDef,
  m01: m01map as unknown as MapDef,
  m02: m02map as unknown as MapDef,
  m03: m03map as unknown as MapDef,
};
/** the campaign's missions, in order */
export const missions: MissionDef[] = [m01, m02, m03] as unknown as MissionDef[];

export function loadMission(id: string): MissionDef {
  const m = missions.find((x) => x.id === id);
  if (!m) throw new Error(`unknown mission ${id}`);
  return m;
}

/** A fresh context for a mission: its map and its definition. */
export function missionContext(id: string, catalog = loadCatalog()): SimContext {
  const def = loadMission(id);
  return createContext(catalog, loadMap(def.map), def);
}

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
