import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateContent } from '../src/sim/content/catalog';
import { contentFiles } from '../src/sim/content/load';
import type { ContentFiles } from '../src/sim/content/types';

const manifest = JSON.parse(readFileSync('public/assets/manifest.json', 'utf8')) as { assets: Record<string, unknown> };
const assets = new Set(Object.keys(manifest.assets));
const clone = (): ContentFiles => JSON.parse(JSON.stringify(contentFiles));

describe('content', () => {
  it('the slice content is valid and every unit and building has art', () => {
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
});
