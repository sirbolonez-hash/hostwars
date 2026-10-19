// Loads the content JSON shipped with the game. Bundled at build time, so the
// simulation never fetches anything mid-match.

import buildings from '../../../content/buildings/slice.json';
import factions from '../../../content/factions.json';
import units from '../../../content/units/slice.json';
import weapons from '../../../content/weapons/slice.json';
import { compileCatalog, type Catalog } from './catalog';
import type { ContentFiles } from './types';

export const contentFiles = { units, buildings, weapons, factions } as unknown as ContentFiles;

export function loadCatalog(knownAssets?: Set<string>): Catalog {
  return compileCatalog(contentFiles, knownAssets);
}
