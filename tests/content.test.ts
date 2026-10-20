import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/sim/content/catalog';
import { contentFiles, loadCatalog, loadMap } from '../src/sim/content/load';
import type { ContentFiles, MapDef } from '../src/sim/content/types';
import { validateMapResources } from '../src/sim/context';

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: Record<string, unknown> };
const assets = new Set(Object.keys(manifest.assets));
const clone = (): ContentFiles => JSON.parse(JSON.stringify(contentFiles));

describe('content', () => {
  it('the slice content is valid and every unit, building and resource has art', () => {
    expect(validateContent(contentFiles, assets)).toEqual([]);
  });
  it('catches an unknown weapon', () => {
    const c = clone();
    c.units[0]!.weapon = 'w_nope';
    expect(validateContent(c).join()).toContain('unknown weapon w_nope');
  });
  it('catches a requirement cycle', () => {
    const c = clone();
    c.buildings.find((b) => b.id === 'bld_wl_capillary')!.requires = ['bld_wl_marrow'];
    expect(validateContent(c).join()).toContain('requirement cycle');
  });
  it('catches seconds sneaking in as fractions', () => {
    const c = clone();
    c.weapons[0]!.cooldown = 0.8;
    expect(validateContent(c).join()).toContain('cooldown must be an integer');
  });
  it('catches starting units that do not fit the HQ supply', () => {
    const c = clone();
    c.factions[0]!.start[0]!.count = 40;
    expect(validateContent(c).join()).toContain('starting units need');
  });
  it('catches a deposit worked directly, or an extractor without slots', () => {
    const c = clone();
    c.resources.find((r) => r.id === 'res_protein')!.slots = 2;
    c.buildings.find((b) => b.id === 'bld_col_siderophore')!.workSlots = 0;
    const errors = validateContent(c).join();
    expect(errors).toContain('worked through an extractor');
    expect(errors).toContain('an extractor needs work slots');
  });
  it('catches resources on the map that overlap, sit on a wall, or crowd a start', () => {
    const catalog = loadCatalog();
    const arena = loadMap('arena');
    expect(validateMapResources(arena, catalog)).toEqual([]);
    const bad: MapDef = JSON.parse(JSON.stringify(arena));
    const first = bad.resources[0]!;
    bad.resources.push({ ...first }); // same tile twice
    bad.resources.push({ type: 'res_glucose_small', tile: [0, 0], field: 1 }); // the border wall
    bad.resources.push({ type: 'res_glucose_small', tile: [bad.starts[0]![0] + 1, bad.starts[0]![1] + 1], field: 1 });
    bad.resources.push({ type: 'res_glucose_small', tile: [20, 40], field: 9 }); // a field with no name
    const errors = validateMapResources(bad, catalog).join('\n');
    expect(errors).toContain('overlaps another');
    expect(errors).toContain('on a wall');
    expect(errors).toContain('inside a start area');
    expect(errors).toContain('which has no name');
  });
});
