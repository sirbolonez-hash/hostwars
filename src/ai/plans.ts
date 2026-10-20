// Each faction's personality (architecture tab, section 8): its build order and what its
// production buildings make.
//
// The White Line is a fortifier with good intelligence: mast cells, an early dendritic cell,
// a quick move to tier 2. The Colony is a rusher and raider: flagellates on the carrier lines
// early, wide biofilm, splitting at the front.

import type { Level } from './types';

export interface PlanStep {
  /** a building type, or a unit type made once (the dendritic cell, platelets) */
  build: string;
  /** how many it wants in all */
  n: number;
  /** not before it has this many workers */
  workers?: number;
  /** not before this tick */
  tick?: number;
  /** where: 'front' faces the enemy; 'mine' guards the carriers at the main field; 'resource' goes on a deposit; default near the base */
  at?: 'front' | 'resource' | 'mine';
}

const S = 20;

export function planFor(faction: string, lv: Level): PlanStep[] {
  if (faction === 'wl') {
    const p: PlanStep[] = [
      { build: 'bld_wl_capillary', n: 1, workers: 9 },
      { build: 'bld_wl_marrow', n: 1 },
      { build: 'bld_wl_aminopump', n: 1, workers: 11, at: 'resource' },
      { build: 'unit_wl_dendritic', n: 1 },
      { build: 'bld_wl_spleen', n: 1, workers: 12 },
    ];
    if (lv.towers > 0) p.push({ build: 'bld_wl_mastcell', n: 1, at: 'mine', tick: 80 * S });
    if (lv.barracks > 1) p.push({ build: 'bld_wl_marrow', n: 2, workers: 16 });
    if (lv.tier2) {
      p.push({ build: 'bld_wl_thymus', n: 1 });
      p.push({ build: 'bld_wl_germinal', n: 1, workers: 16 });
    }
    if (lv.towers > 1) p.push({ build: 'bld_wl_mastcell', n: 2, at: 'front', tick: 4 * 60 * S });
    return p;
  }
  const p: PlanStep[] = [
    { build: 'bld_col_fission', n: 1 },
    { build: 'bld_col_flagellum', n: 1, workers: 11 },
    { build: 'bld_col_siderophore', n: 1, workers: 12, at: 'resource' },
  ];
  if (lv.barracks > 1) p.push({ build: 'bld_col_fission', n: 2, workers: 15 });
  if (lv.towers > 0) p.push({ build: 'bld_col_toxinspire', n: 1, at: 'front', tick: 2 * 60 * S });
  if (lv.tier2) p.push({ build: 'bld_col_toxinfoundry', n: 1, workers: 16 });
  if (lv.towers > 1) p.push({ build: 'bld_col_toxinspire', n: 2, at: 'front', tick: 4 * 60 * S });
  return p;
}

/** What each production building makes, in a repeating cycle (units it cannot make yet are skipped). */
export const MIX: Record<string, string[]> = {
  // neutrophils live three minutes: fewer of them, more monocytes that grow into macrophages
  bld_wl_marrow: ['unit_wl_monocyte', 'unit_wl_neutrophil', 'unit_wl_monocyte', 'unit_wl_monocyte', 'unit_wl_nk'],
  bld_wl_spleen: ['unit_wl_eosinophil'],
  bld_wl_thymus: ['unit_wl_cd8', 'unit_wl_cd8', 'unit_wl_cd4', 'unit_wl_cd8'],
  bld_wl_germinal: ['unit_wl_plasma'],
  bld_col_fission: ['unit_col_coccus', 'unit_col_bacillus', 'unit_col_coccus', 'unit_col_bacillus'],
  bld_col_flagellum: ['unit_col_flagellate', 'unit_col_spirochete', 'unit_col_capsule', 'unit_col_flagellate', 'unit_col_strep'],
  bld_col_toxinfoundry: ['unit_col_toxin'],
};

/** Supply buildings and expansions, by faction. */
export const SUPPLY: Record<string, string> = { wl: 'bld_wl_capillary', col: 'bld_col_fermentation' };
export const EXPANSION: Record<string, string> = { wl: 'bld_wl_outpost', col: 'bld_col_biofilm_core' };
