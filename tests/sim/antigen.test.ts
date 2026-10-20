// Gate 6: antigen presentation and the White Line's second tier. A dendritic cell samples an
// enemy and carries it home; the lymph node opens that family; specific cells are trained
// against it; CD4 helpers boost the cells around them.
import { describe, expect, it } from 'vitest';
import { AURA_RANGE, damageOf, IL2_COOLDOWN, SPEC_AGAINST, SPEC_FOR } from '../../src/sim/combat/combat';
import { LAB_TICKS, SAMPLE_TICKS } from '../../src/sim/intel/antigen';
import { entityById, spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import type { SimEvent } from '../../src/sim/sim';
import { arenaMatch, asciiMap, catalog, harness, matchOn, type Harness } from './helpers';

const T = 256;
const W = (id: string) => catalog.weapons.get(id)!;
const p1 = (h: Harness) => h.world.players[0]!;
const of = <K extends SimEvent['type']>(evs: SimEvent[], type: K) => evs.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const hqOf = (w: World) => w.entities.find((e) => e.owner === 1 && e.type === 'bld_wl_lymphnode')!;

function dev(h: Harness, type: string, tx: number, ty: number, owner = 1): Entity {
  const before = h.world.nextId;
  h.cmd(owner, { type: 'DEV_SPAWN', units: [], unit: type, count: 1, x: tx * T + 128, y: ty * T + 128 });
  h.run(1);
  const b = entityById(h.world, before);
  if (!b || b.type !== type) throw new Error(`could not place ${type} at ${tx},${ty}: ${h.problems.at(-1)}`);
  return b;
}

/** An open 48x24 field; both sides' starting units removed, dev commands on. */
function field(): Harness {
  const rows = Array.from({ length: 24 }, (_, y) => Array.from({ length: 48 }, (_, x) => (x === 0 || y === 0 || x === 47 || y === 23 ? '#' : '.')).join(''));
  const { ctx, world } = matchOn(asciiMap('field', rows), 7);
  world.dev = true;
  const h = harness(world, ctx);
  for (const owner of [1, 2]) h.cmd(owner, { type: 'DEV_KILL', units: [], targets: world.entities.filter((e) => !e.building && e.owner === owner).map((e) => e.id) });
  h.run(1);
  return h;
}
const put = (h: Harness, type: string, owner: number, tx: number, ty: number): Entity => spawnUnit(h.world, catalog, type, owner, tx * T + 128, ty * T + 128);

describe('antigen presentation (gate 6)', () => {
  it('sample, carry home, process: the family opens, and tier 2 with it', () => {
    const h = arenaMatch();
    const spleen = dev(h, 'bld_wl_spleen', 16, 31);
    expect(spleen.build).toBeNull();
    const hq = hqOf(h.world);
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 1000, advanced: 500 });
    h.run(1);
    expect(h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_thymus' })).toBe('requirements');
    // an unarmed Colony building out in the open, and a dendritic cell close enough to see it
    const target = dev(h, 'bld_col_fermentation', 44, 30, 2);
    const dc = dev(h, 'unit_wl_dendritic', 39, 30);
    expect(h.try(1, { type: 'SAMPLE', units: [dc.id], target: target.id })).toBeNull();
    const seen: SimEvent[] = [];
    h.run(SAMPLE_TICKS + 200 + LAB_TICKS + 400, (evs) => {
      seen.push(...evs);
      return of(evs, 'antigen_opened').length > 0;
    });
    const sampled = of(seen, 'sampled')[0]!;
    const delivered = of(seen, 'sample_delivered')[0]!;
    const opened = of(seen, 'antigen_opened')[0]!;
    expect(sampled.family).toBe('staph');
    expect(delivered.lab).toBe(hq.id);
    expect(opened.family).toBe('staph');
    expect(opened.tick - delivered.tick).toBe(LAB_TICKS);
    expect(p1(h).antigens).toEqual(['staph']);
    expect(dc.sample).toBe('');
    expect(dc.order.kind).toBe('idle');
    // tier 2 is open
    expect(h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_thymus' })).toBeNull();
    expect(h.problems).toEqual([]);
  });

  it('a dendritic cell killed on the way home loses its sample; nothing opens', () => {
    const h = arenaMatch();
    const target = dev(h, 'bld_col_fermentation', 44, 30, 2);
    const dc = dev(h, 'unit_wl_dendritic', 39, 30);
    h.cmd(1, { type: 'SAMPLE', units: [dc.id], target: target.id });
    h.run(400, (evs) => of(evs, 'sampled').length > 0);
    expect(dc.sample).toBe('staph');
    expect(dc.job?.kind).toBe('deliver');
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [dc.id] });
    h.run(LAB_TICKS + 300);
    expect(p1(h).antigens).toEqual([]);
    expect(hqOf(h.world).lab).toEqual([]);
    expect(h.problems).toEqual([]);
  });

  it('who can sample what: only a dendritic cell, only an enemy it can see', () => {
    const h = arenaMatch();
    const glut = h.world.entities.find((e) => e.owner === 1 && e.type === 'unit_wl_glut')!;
    const dc = dev(h, 'unit_wl_dendritic', 14, 30);
    const hidden = h.world.entities.find((e) => e.owner === 2 && e.type === 'bld_col_biofilm_core')!;
    const crystal = h.world.entities.find((e) => e.type === 'res_glucose_small')!;
    expect(h.try(1, { type: 'SAMPLE', units: [glut.id], target: hidden.id })).toBe('no_dendritic');
    expect(h.try(1, { type: 'SAMPLE', units: [dc.id], target: hidden.id })).toBe('unknown_target'); // out of sight
    expect(h.try(1, { type: 'SAMPLE', units: [dc.id], target: glut.id })).toBe('unknown_target'); // one of ours
    expect(h.try(1, { type: 'SAMPLE', units: [dc.id], target: crystal.id })).toBe('unknown_target');
  });
});

describe('specific cells (gate 6)', () => {
  it('acquired cells are trained against the family opened last: +50% against it, −30% against the rest', () => {
    const h = arenaMatch();
    const thymus = dev(h, 'bld_wl_thymus', 16, 31);
    const marrow = dev(h, 'bld_wl_marrow', 20, 22);
    p1(h).antigens.push('staph');
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 1000, advanced: 500 });
    h.cmd(1, { type: 'TRAIN', units: [], building: thymus.id, unit: 'unit_wl_cd8', count: 1 });
    h.cmd(1, { type: 'TRAIN', units: [], building: marrow.id, unit: 'unit_wl_neutrophil', count: 1 });
    h.run(catalog.units.get('unit_wl_cd8')!.trainTicks + 5);
    const cd8 = h.world.entities.find((e) => e.type === 'unit_wl_cd8')!;
    const neut = h.world.entities.find((e) => e.owner === 1 && e.type === 'unit_wl_neutrophil')!;
    expect(cd8.spec).toBe('staph');
    expect(neut.spec).toBe('');
    const w = W('w_cd8_perforin');
    const coccus = put(h, 'unit_col_coccus', 2, 50, 10); // staph, off the biofilm
    const bacillus = put(h, 'unit_col_bacillus', 2, 50, 12);
    expect(damageOf(h.ctx, w, coccus, { power: 1000, spec: 'staph' })).toBe(Math.floor((12 * SPEC_FOR) / 1000));
    expect(damageOf(h.ctx, w, bacillus, { power: 1000, spec: 'staph' })).toBe(Math.floor((12 * SPEC_AGAINST) / 1000));
    expect(damageOf(h.ctx, w, bacillus, { power: 1000, spec: '' })).toBe(12);
    expect(h.problems).toEqual([]);
  });

  it('IL-2: an acquired cell near a CD4 helper attacks faster', () => {
    const cadence = (withHelper: boolean) => {
      const h = field();
      const cd8 = put(h, 'unit_wl_cd8', 1, 20, 12);
      if (withHelper) put(h, 'unit_wl_cd4', 1, 17, 12);
      const c = put(h, 'unit_col_bacillus', 2, 21, 12);
      c.hp = c.maxHp = 100_000;
      h.cmd(1, { type: 'ATTACK', units: [cd8.id], target: c.id });
      h.run(120);
      const l = of(h.events, 'launched').filter((e) => e.entity === cd8.id).map((e) => e.tick);
      return l[2]! - l[1]!;
    };
    const w = W('w_cd8_perforin');
    expect(cadence(false)).toBe(w.cooldown);
    expect(cadence(true)).toBe(Math.floor((w.cooldown * IL2_COOLDOWN) / 1000));
    expect(AURA_RANGE).toBe(6 * T);
  });

  it('IFN-γ: a macrophage near a CD4 hits harder and can swallow a capsule', () => {
    const fight = (withHelper: boolean) => {
      const h = field();
      const m = put(h, 'unit_wl_macrophage', 1, 20, 12);
      if (withHelper) put(h, 'unit_wl_cd4', 1, 16, 9);
      const cap = put(h, 'unit_col_capsule', 2, 21, 12);
      h.cmd(1, { type: 'ATTACK', units: [m.id], target: cap.id });
      h.run(40);
      return { engulfed: of(h.events, 'engulfed').length, hit: of(h.events, 'hit').find((e) => e.entity === m.id)?.amount };
    };
    const without = fight(false);
    expect(without.engulfed).toBe(0); // the capsule slips out
    expect(without.hit).toBe(16);
    expect(fight(true).engulfed).toBe(1);
  });
});
