// Gate 6: the Colony's own rules. Biofilm laid by its cores, feeders that walk to a site and
// become the building, splitting on own biofilm, and what biofilm does to both sides.
import { describe, expect, it } from 'vitest';
import { BIOFILM_GROW, BIOFILM_MAX, BIOFILM_START } from '../../src/sim/colony/biofilm';
import { SPLIT_CALM } from '../../src/sim/colony/colony';
import { footprintOrigin } from '../../src/sim/context';
import { entityById, spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import type { SimEvent } from '../../src/sim/sim';
import { arenaMatch, asciiMap, catalog, harness, matchOn, type Harness } from './helpers';

const T = 256;
const mine = (w: World, type: string, owner = 2) => w.entities.filter((e) => e.owner === owner && e.type === type);
const p2 = (h: Harness) => h.world.players[1]!;
const of = <K extends SimEvent['type']>(evs: SimEvent[], type: K) => evs.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const put = (h: Harness, type: string, owner: number, tx: number, ty: number): Entity => spawnUnit(h.world, catalog, type, owner, tx * T + 128, ty * T + 128);

/** A finished building from the test lab, centred on tile (tx, ty). */
function devBuilding(h: Harness, type: string, tx: number, ty: number, owner = 2): Entity {
  const before = h.world.nextId;
  h.cmd(owner, { type: 'DEV_SPAWN', units: [], unit: type, count: 1, x: tx * T + 128, y: ty * T + 128 });
  h.run(1);
  const b = entityById(h.world, before);
  if (!b || b.type !== type) throw new Error(`could not place ${type} at ${tx},${ty}: ${h.problems.at(-1)}`);
  return b;
}

/** The arena with the Colony's fighters out of the way (feeders kept), dev commands on. */
function colonyArena(): Harness {
  const h = arenaMatch();
  h.cmd(2, { type: 'DEV_KILL', units: [], targets: mine(h.world, 'unit_col_flagellate').map((e) => e.id) });
  h.run(1);
  return h;
}

describe('biofilm (gate 6)', () => {
  it('the starting core has spread in full; a new core lays 3 tiles at once and one more every few seconds, never on walls', () => {
    const h = colonyArena();
    const bf = h.ctx.biofilm;
    // the starting core, centred on tile (92, 26): a full 10 tiles from the first tick
    expect(bf.at(92, 26)).toBe(2);
    expect(bf.at(92 - BIOFILM_MAX, 26)).toBe(2);
    expect(bf.at(92 - BIOFILM_MAX - 1, 26)).toBe(0);
    expect(bf.at(10, 26)).toBe(0); // nothing at the White Line's base
    // a new core in the middle of the map
    const core = devBuilding(h, 'bld_col_biofilm_core', 70, 30);
    h.run(1); // biofilm is laid at the start of the next tick
    const [cx, cy] = [Math.floor(core.x / T), Math.floor(core.y / T)];
    expect(bf.at(cx + BIOFILM_START, cy)).toBe(2);
    expect(bf.at(cx + BIOFILM_START + 1, cy)).toBe(0);
    h.run(BIOFILM_GROW);
    expect(bf.at(cx + BIOFILM_START + 1, cy)).toBe(2);
    h.run(BIOFILM_GROW * (BIOFILM_MAX - BIOFILM_START));
    expect(cx).toBe(71);
    expect(bf.at(cx - BIOFILM_MAX, cy)).toBe(2); // tile 61, open ground
    expect(bf.at(62, cy)).toBe(0); // the wall at x 62–63 carries none
    expect(bf.at(cx - BIOFILM_MAX - 1, cy)).toBe(0);
    // the core dies: its biofilm goes with it
    h.cmd(2, { type: 'DEV_KILL', units: [], targets: [core.id] });
    h.run(2);
    expect(bf.at(cx, cy)).toBe(0);
    expect(h.problems).toEqual([]);
  });

  it('biofilm guards the Colony: its units mend on it, and immune cells wade through it', () => {
    const h = colonyArena();
    const c = put(h, 'unit_col_coccus', 2, 86, 32); // on own biofilm
    const far = put(h, 'unit_col_coccus', 2, 70, 12); // off it
    c.hp = 20;
    far.hp = 20;
    h.run(200);
    expect(c.hp).toBeGreaterThanOrEqual(29);
    expect(c.hp).toBeLessThanOrEqual(31);
    expect(far.hp).toBe(20);
    // drag: the same walk, on and off the Colony's biofilm
    const rows = Array.from({ length: 30 }, (_, y) => Array.from({ length: 60 }, (_, x) => (x === 0 || y === 0 || x === 59 || y === 29 ? '#' : '.')).join(''));
    const { ctx, world } = matchOn(asciiMap('drag', rows), 3);
    world.dev = true;
    const g = harness(world, ctx);
    g.cmd(1, { type: 'DEV_KILL', units: [], targets: world.entities.filter((e) => !e.building && e.owner !== 0).map((e) => e.id) });
    g.run(1);
    const coreTile = Math.floor(world.entities.find((e) => e.type === 'bld_col_biofilm_core')!.y / T);
    const onFilm = spawnUnit(world, catalog, 'unit_wl_neutrophil', 1, 50 * T + 128, (coreTile + 6) * T + 128);
    const offFilm = spawnUnit(world, catalog, 'unit_wl_neutrophil', 1, 8 * T + 128, 20 * T + 128);
    expect(ctx.biofilm.under(onFilm)).toBe(2);
    g.cmd(1, { type: 'MOVE', units: [onFilm.id], x: 44 * T + 128, y: onFilm.y });
    g.cmd(1, { type: 'MOVE', units: [offFilm.id], x: 2 * T + 128, y: offFilm.y });
    const [x0, x1] = [onFilm.x, offFilm.x];
    g.run(12);
    const dOn = x0 - onFilm.x;
    const dOff = x1 - offFilm.x;
    expect(dOff).toBeGreaterThan(0);
    expect(dOn).toBeLessThan(dOff);
    expect(dOn * 1000).toBeGreaterThanOrEqual(dOff * 750);
    expect(h.problems).toEqual([]);
    expect(g.problems).toEqual([]);
  });
});

describe('a feeder becomes the building (gate 6)', () => {
  it('pays at the order, walks there, and turns into a growing building; its supply is freed', () => {
    const h = colonyArena();
    const feeders = mine(h.world, 'unit_col_feeder');
    const f = feeders.sort((a, b) => a.id - b.id)[0]!;
    const used = p2(h).supplyUsed;
    const b0 = p2(h).basic;
    expect(h.try(2, { type: 'BUILD_AT', units: [f.id], build: 'bld_col_fission', tx: 70, ty: 30 })).toBe('no_biofilm');
    expect(h.try(1, { type: 'BUILD_AT', units: [f.id], build: 'bld_wl_marrow', tx: 15, ty: 30 })).toBe('not_owner');
    expect(h.try(2, { type: 'BUILD_AT', units: [f.id], build: 'bld_col_toxinfoundry', tx: 85, ty: 31 })).toBe('requirements');
    expect(p2(h).basic).toBe(b0);
    expect(h.try(2, { type: 'BUILD_AT', units: [f.id], build: 'bld_col_fermentation', tx: 85, ty: 31 })).toBeNull();
    expect(p2(h).basic).toBe(b0 - 120);
    expect(f.order.kind).toBe('job');
    let became: Extract<SimEvent, { type: 'became' }> | undefined;
    h.run(400, (evs) => {
      became = of(evs, 'became')[0];
      return became !== undefined;
    });
    expect(became).toBeDefined();
    expect(entityById(h.world, f.id)).toBeUndefined();
    const b = entityById(h.world, became!.building)!;
    expect(b.type).toBe('bld_col_fermentation');
    expect(b.build).not.toBeNull();
    expect(b.hp).toBe(Math.floor(b.maxHp / 10));
    expect(p2(h).supplyUsed).toBe(used - 1);
    expect(p2(h).basic).toBe(b0 - 120); // nothing more at the site
    // grows like any other building, then gives its supply
    const cap = p2(h).supplyCap;
    h.run(catalog.buildings.get('bld_col_fermentation')!.buildTicks + 2);
    expect(b.build).toBeNull();
    expect(p2(h).supplyCap).toBe(cap + 10);
    expect(h.problems).toEqual([]);
  });

  it('an extractor: the feeder becomes it on the iron deposit, linked and worked once grown', () => {
    const h = colonyArena();
    const f = mine(h.world, 'unit_col_feeder')[0]!;
    const iron = h.world.entities.find((e) => e.type === 'res_iron' && e.x > 50 * T)!;
    const [ox, oy] = footprintOrigin(h.ctx, iron.type, iron.x, iron.y);
    expect(h.try(2, { type: 'BUILD_AT', units: [f.id], build: 'bld_col_siderophore', tx: ox + 1, ty: oy })).not.toBeNull();
    expect(h.try(2, { type: 'BUILD_AT', units: [f.id], build: 'bld_col_siderophore', tx: ox, ty: oy })).toBeNull();
    h.run(400, (evs) => of(evs, 'became').length > 0);
    const ex = mine(h.world, 'bld_col_siderophore')[0]!;
    expect(ex.res!.link).toBe(iron.id);
    expect(iron.res!.link).toBe(ex.id);
    expect(h.problems).toEqual([]);
  });

  it('the money comes back if the feeder dies, is ordered elsewhere, or finds its site taken', () => {
    const h = colonyArena();
    const [a, b, c] = mine(h.world, 'unit_col_feeder').sort((x, y) => x.id - y.id);
    const b0 = p2(h).basic;
    // killed on the way
    h.cmd(2, { type: 'BUILD_AT', units: [a!.id], build: 'bld_col_fermentation', tx: 85, ty: 31 });
    h.run(1);
    expect(p2(h).basic).toBe(b0 - 120);
    h.cmd(2, { type: 'DEV_KILL', units: [], targets: [a!.id] });
    h.run(1);
    expect(p2(h).basic).toBe(b0);
    // given a new order
    h.cmd(2, { type: 'BUILD_AT', units: [b!.id], build: 'bld_col_fermentation', tx: 85, ty: 31 });
    h.run(1);
    h.cmd(2, { type: 'MOVE', units: [b!.id], x: 90 * T, y: 40 * T });
    h.run(1);
    expect(p2(h).basic).toBe(b0);
    expect(b!.job).toBeNull();
    // the site taken before it gets there
    h.cmd(2, { type: 'BUILD_AT', units: [c!.id], build: 'bld_col_fermentation', tx: 85, ty: 31 });
    h.run(1);
    devBuilding(h, 'bld_col_toxinspire', 86, 32);
    const failed: Extract<SimEvent, { type: 'build_failed' }>[] = [];
    h.run(400, (evs) => {
      failed.push(...of(evs, 'build_failed'));
      return failed.length > 0;
    });
    expect(failed[0]?.entity).toBe(c!.id);
    expect(p2(h).basic).toBe(b0);
    expect(entityById(h.world, c!.id)).toBeDefined();
    expect(h.problems).toEqual([]);
  });

  it('the White Line cannot build this way, and a unit that is not a feeder cannot', () => {
    const h = arenaMatch();
    const glut = mine(h.world, 'unit_wl_glut', 1)[0]!;
    expect(h.try(1, { type: 'BUILD_AT', units: [glut.id], build: 'bld_wl_capillary', tx: 15, ty: 30 })).toBe('cannot_produce');
    const flag = mine(h.world, 'unit_col_flagellate')[0]!;
    expect(h.try(2, { type: 'BUILD_AT', units: [flag.id], build: 'bld_col_fermentation', tx: 85, ty: 31 })).toBe('no_feeder');
  });
});

describe('splitting (gate 6)', () => {
  it('a calm fighter on own biofilm splits: full price, supply reserved, still for half its training, then two', () => {
    const h = colonyArena();
    const c = put(h, 'unit_col_coccus', 2, 86, 33);
    const off = put(h, 'unit_col_coccus', 2, 70, 12);
    h.run(1);
    const b0 = p2(h).basic;
    const used = p2(h).supplyUsed;
    expect(h.try(2, { type: 'SPLIT', units: [off.id] })).toBe('cannot_split');
    c.lastCombat = h.world.tick; // just fought
    expect(h.try(2, { type: 'SPLIT', units: [c.id] })).toBe('cannot_split');
    h.run(SPLIT_CALM);
    expect(h.try(2, { type: 'SPLIT', units: [c.id] })).toBeNull();
    expect(p2(h).basic).toBe(b0 - 40);
    expect(p2(h).supplyReserved).toBe(1);
    expect(c.order.kind).toBe('morph');
    h.cmd(2, { type: 'MOVE', units: [c.id], x: 80 * T, y: 20 * T }); // ignored while it splits
    const half = Math.floor(catalog.units.get('unit_col_coccus')!.trainTicks / 2);
    let split: Extract<SimEvent, { type: 'split' }> | undefined;
    h.run(half + 2, (evs) => {
      split = of(evs, 'split')[0];
      return split !== undefined;
    });
    expect(split).toBeDefined();
    const cocci = mine(h.world, 'unit_col_coccus').filter((e) => e.id !== off.id);
    expect(cocci.length).toBe(2);
    expect(p2(h).supplyReserved).toBe(0);
    expect(p2(h).supplyUsed).toBe(used + 1);
    const twin = cocci.find((e) => e.id !== c.id)!;
    expect(Math.abs(twin.x - c.x) + Math.abs(twin.y - c.y)).toBeLessThan(3 * T);
    expect(h.problems).toEqual([]);
  });

  it('a feeder does not split, and a split is refused without the money or the supply', () => {
    const h = colonyArena();
    const f = mine(h.world, 'unit_col_feeder')[0]!;
    expect(h.try(2, { type: 'SPLIT', units: [f.id] })).toBe('cannot_split');
    const c = put(h, 'unit_col_coccus', 2, 86, 33);
    h.run(1);
    p2(h).basic = 10;
    expect(h.try(2, { type: 'SPLIT', units: [c.id] })).toBe('no_resources');
    p2(h).basic = 500;
    p2(h).supplyCap = p2(h).supplyUsed;
    expect(h.try(2, { type: 'SPLIT', units: [c.id] })).toBe('supply_capped');
  });

  it('save in the middle of a walk to a site and of a split: identical to never stopping', async () => {
    const { runHeadless } = await import('../../src/sim/headless');
    const { snapshot, restore } = await import('../../src/sim/core/world');
    const { contextForWorld } = await import('../../src/sim/context');
    const { CommandQueue } = await import('../../src/sim/commands/commands');
    const { arena, newCtx, setup } = await import('./helpers');
    const script = (world: World, tick: number) => {
      const at = (seq: number, cmd: Parameters<Harness['cmd']>[1]) => [{ player: 2, seq, tick, cmd }];
      const feeders = world.entities.filter((e) => e.owner === 2 && e.type === 'unit_col_feeder').sort((a, b) => a.id - b.id);
      const flag = world.entities.find((e) => e.owner === 2 && e.type === 'unit_col_flagellate');
      if (tick === 0) return at(1, { type: 'BUILD_AT', units: [feeders[0]!.id], build: 'bld_col_fermentation', tx: 90, ty: 16 });
      if (tick === 5 && flag) return at(2, { type: 'SPLIT', units: [flag.id] });
      return [];
    };
    const full = runHeadless(newCtx(), setup, { ticks: 700, script, invariants: true });
    expect(full.problems).toEqual([]);
    expect(full.world.entities.filter((e) => e.type === 'unit_col_flagellate').length).toBe(2);
    expect(full.world.entities.filter((e) => e.type === 'bld_col_fermentation').length).toBe(1);
    const half = runHeadless(newCtx(), setup, { ticks: 40, script });
    expect(half.world.entities.some((e) => e.job?.kind === 'build_at')).toBe(true);
    expect(half.world.entities.some((e) => e.morph?.copy)).toBe(true);
    const world = restore(snapshot(half.world));
    const resumed = runHeadless(contextForWorld(catalog, arena, world), setup, { ticks: 660, script, start: world, queue: CommandQueue.fromJSON(half.queue.toJSON()) });
    expect(resumed.finalHash).toBe(full.finalHash);
  });
});
