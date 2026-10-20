// Gate 4 acceptance: every charge, refund and blocked-exit rule of production and construction.
import { describe, expect, it } from 'vitest';
import { CANCEL_REFUND, QUEUE_MAX } from '../../src/sim/build/production';
import { entityById, type Entity, type World } from '../../src/sim/core/world';
import { arenaMatch, asciiMap, catalog, harness, matchOn, type Harness } from './helpers';

const T = 256;
const GLUT = catalog.units.get('unit_wl_glut')!;

const hqOf = (w: World, owner = 1) => w.entities.find((e) => e.owner === owner && catalog.buildings.get(e.type)?.role === 'hq')!;
const mine = (w: World, type: string, owner = 1) => w.entities.filter((e) => e.owner === owner && e.type === type);
const p1 = (h: Harness) => h.world.players[0]!;
const money = (h: Harness) => [p1(h).basic, p1(h).advanced];
const centre = (tx: number, ty: number) => [tx * T + 128, ty * T + 128] as const;

/** A finished building from the test lab, its top-left tile at (tx, ty). */
function devBuilding(h: Harness, type: string, tx: number, ty: number, owner = 1): Entity {
  const [fw, fh] = catalog.buildings.get(type)!.footprint;
  const before = h.world.nextId;
  h.cmd(owner, { type: 'DEV_SPAWN', units: [], unit: type, count: 1, x: tx * T + Math.floor((fw - 1) / 2) * T + 128, y: ty * T + Math.floor((fh - 1) / 2) * T + 128 });
  h.run(1);
  const b = entityById(h.world, before);
  if (!b || b.type !== type) throw new Error(`could not place ${type} at ${tx},${ty}: ${h.problems.at(-1)}`);
  return b;
}

function devUnits(h: Harness, type: string, n: number, tx: number, ty: number, owner = 1): Entity[] {
  const before = h.world.nextId;
  const [x, y] = centre(tx, ty);
  h.cmd(owner, { type: 'DEV_SPAWN', units: [], unit: type, count: n, x, y });
  h.run(1);
  return h.world.entities.filter((e) => e.id >= before && e.type === type);
}

describe('production queues (gate 4)', () => {
  it('an order pays and reserves supply in one action; the unit appears at the exit after its training time', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const [b0] = money(h);
    const used0 = p1(h).supplyUsed;
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 2 })).toBeNull();
    expect(p1(h).basic).toBe(b0! - 2 * GLUT.cost[0]);
    expect(p1(h).supplyReserved).toBe(2);
    expect(hq.queue!.length).toBe(2);
    const trained: number[] = [];
    h.run(2 * GLUT.trainTicks + 5, (evs) => {
      for (const e of evs) if (e.type === 'trained') trained.push(h.world.tick);
    });
    expect(h.problems).toEqual([]);
    expect(trained.length).toBe(2);
    expect(trained[0]).toBe(GLUT.trainTicks); // ordered on tick 0, it trains from that same tick
    expect(trained[1]! - trained[0]!).toBe(GLUT.trainTicks);
    expect(p1(h).supplyUsed).toBe(used0 + 2);
    expect(p1(h).supplyReserved).toBe(0);
    expect(p1(h).basic).toBe(b0! - 2 * GLUT.cost[0]); // charged once, nothing more
    const fresh = mine(h.world, 'unit_wl_glut').at(-1)!;
    expect(Math.abs(fresh.y - 28 * T)).toBeLessThan(2 * T); // below the lymph node, at its exit
  });

  it('refused orders charge nothing: no money, no supply, a full queue, the wrong building', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    p1(h).basic = 100;
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 2 })).toBe('no_resources');
    expect(p1(h).basic).toBe(100);
    expect(p1(h).supplyReserved).toBe(0);
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 5000, advanced: 0 });
    devUnits(h, 'unit_wl_neutrophil', 10, 16, 32); // 9 + 10 = 19 of 20
    const b = p1(h).basic;
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 2 })).toBe('supply_capped');
    expect(p1(h).basic).toBe(b);
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 })).toBeNull();
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 })).toBe('supply_capped'); // the reserved one counts
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_neutrophil', count: 1 })).toBe('cannot_produce');
    expect(h.try(1, { type: 'TRAIN', units: [], building: hqOf(h.world, 2).id, unit: 'unit_col_feeder', count: 1 })).toBe('not_owner');
    const cap = devBuilding(h, 'bld_wl_capillary', 15, 26);
    expect(cap.build).toBeNull();
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 4 })).toBeNull();
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 })).toBe('queue_full');
    expect(hq.queue!.length).toBe(QUEUE_MAX);
  });

  it('cancel: a waiting unit is refunded in full, a started one 75%, each exactly once', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const b0 = p1(h).basic;
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 3 });
    h.run(50);
    expect(hq.queue![0]!.started).toBe(true);
    expect(hq.queue![1]!.started).toBe(false);
    expect(h.try(1, { type: 'CANCEL', units: [], building: hq.id, what: 'queue', index: -1 })).toBeNull(); // the last, waiting
    expect(p1(h).basic).toBe(b0 - 3 * 60 + 60);
    expect(h.try(1, { type: 'CANCEL', units: [], building: hq.id, what: 'queue', index: 0 })).toBeNull(); // the one training
    expect(p1(h).basic).toBe(b0 - 3 * 60 + 60 + Math.floor((60 * CANCEL_REFUND) / 1000));
    expect(p1(h).supplyReserved).toBe(1);
    // the remaining one now starts from zero and trains in full
    h.run(GLUT.trainTicks + 2);
    expect(hq.queue!.length).toBe(0);
    expect(h.try(1, { type: 'CANCEL', units: [], building: hq.id, what: 'queue', index: 0 })).toBe('nothing_to_cancel');
    const refunds = h.events.filter((e) => e.type === 'refunded');
    expect(refunds.length).toBe(2);
    expect(h.problems).toEqual([]);
  });

  it('a production building destroyed at 99%: no ghost unit; waiting units refunded, the one in training lost', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const b0 = p1(h).basic;
    const units0 = h.world.entities.filter((e) => !e.building).length;
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 3 });
    h.run(GLUT.trainTicks - 3);
    expect(hq.queue![0]!.done).toBe(GLUT.trainTicks - 2);
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [hq.id] });
    h.run(5);
    expect(h.problems).toEqual([]);
    expect(h.events.some((e) => e.type === 'trained')).toBe(false);
    expect(h.world.entities.filter((e) => !e.building).length).toBe(units0);
    expect(p1(h).basic).toBe(b0 - 60); // two refunded in full, the third lost
    expect(p1(h).supplyReserved).toBe(0);
  });

  it('a blocked exit: the unit waits finished, is charged once, never overlaps the next, and appears once there is room', () => {
    // a sealed 6x6 room around the start; the lymph node fills the top-left, capillaries the rest
    const rows = Array.from({ length: 20 }, (_, y) =>
      Array.from({ length: 40 }, (_, x) => (x === 0 || y === 0 || x === 39 || y === 19 || ((x === 7 || y === 7) && x <= 7 && y <= 7) ? '#' : '.')).join(''),
    );
    const { ctx, world } = matchOn({ ...asciiMap('sealed', rows), starts: [[1, 1], [30, 10]] }, 3);
    world.dev = true;
    const h = harness(world, ctx);
    const hq = hqOf(world);
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: world.entities.filter((e) => e.owner === 1 && !e.building).map((e) => e.id) });
    h.run(1);
    const blockers = [[5, 1], [5, 3], [5, 5], [1, 5], [3, 5]].map(([x, y]) => devBuilding(h, 'bld_wl_capillary', x!, y!));
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 1000, advanced: 0 });
    h.run(1);
    const b0 = p1(h).basic;
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 2 });
    let blockedEvents = 0;
    h.run(GLUT.trainTicks + 200, (evs) => {
      blockedEvents += evs.filter((e) => e.type === 'exit_blocked').length;
    });
    expect(blockedEvents).toBe(1);
    expect(hq.queue![0]!.blocked).toBe(true);
    expect(hq.queue![1]!.done).toBe(0); // the next one waits, no overlap
    expect(mine(world, 'unit_wl_glut').length).toBe(0);
    expect(p1(h).basic).toBe(b0 - 120);
    // room appears (the blocker leaves at the end of its tick): exactly one unit; the next one starts training
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [blockers[4]!.id] });
    h.run(3);
    expect(mine(world, 'unit_wl_glut').length).toBe(1);
    expect(hq.queue!.length).toBe(1);
    expect(hq.queue![0]!.started).toBe(true);
    expect(p1(h).basic).toBe(b0 - 120);
    expect(h.problems).toEqual([]);
  });

  it('a supply building destroyed: units stay, training goes on, nothing new starts until back under the cap', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 5000, advanced: 0 });
    const cap = devBuilding(h, 'bld_wl_capillary', 15, 26);
    expect(p1(h).supplyCap).toBe(32);
    devUnits(h, 'unit_wl_neutrophil', 21, 18, 34); // 9 + 21 = 30 of 32
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 2 });
    h.run(20);
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [cap.id] });
    h.run(1);
    expect(p1(h).supplyCap).toBe(20);
    expect(p1(h).supplyUsed).toBe(30); // over the cap, and allowed: the cap fell
    expect(h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 })).toBe('supply_capped');
    h.run(GLUT.trainTicks * 2);
    expect(mine(h.world, 'unit_wl_glut').length).toBe(9); // the one in training finished; the next did not start
    expect(hq.queue!.length).toBe(1);
    expect(hq.queue![0]!.started).toBe(false);
    // losses bring the owner back under the cap: the waiting unit starts
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: mine(h.world, 'unit_wl_neutrophil').slice(0, 12).map((e) => e.id) });
    h.run(2);
    expect(hq.queue![0]!.started).toBe(true);
    expect(h.problems).toEqual([]);
  });

  it('rally on a crystal: new carriers go mining; rally on a point: they walk there', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const crystal = h.world.entities.find((e) => e.res?.field === 1)!;
    h.try(1, { type: 'SET_RALLY', units: [], building: hq.id, x: crystal.x, y: crystal.y, target: crystal.id });
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 });
    h.run(GLUT.trainTicks + 2);
    const g = mine(h.world, 'unit_wl_glut').at(-1)!;
    expect(g.gather).not.toBeNull();
    h.try(1, { type: 'SET_RALLY', units: [], building: hq.id, x: 18 * T, y: 34 * T, target: 0 });
    h.try(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 1 });
    h.run(GLUT.trainTicks + 200);
    const w = mine(h.world, 'unit_wl_glut').at(-1)!;
    expect(w.gather).toBeNull();
    expect(Math.hypot(w.x - 18 * T, w.y - 34 * T)).toBeLessThan(T);
    expect(h.problems).toEqual([]);
  });

  it('a monocyte turns into a macrophage: paid at the order, supply reserved, a still unit until done', () => {
    const h = arenaMatch();
    const mono = mine(h.world, 'unit_wl_monocyte')[0]!;
    expect(h.try(1, { type: 'DEPLOY', units: [mono.id] })).toBe('requirements'); // needs the spleen
    devBuilding(h, 'bld_wl_spleen', 16, 30);
    expect(h.try(1, { type: 'DEPLOY', units: [mono.id] })).toBe('no_resources'); // 40 amino
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 0, advanced: 100 });
    h.run(1);
    const [b, a] = money(h);
    expect(h.try(1, { type: 'DEPLOY', units: [mono.id] })).toBeNull();
    expect(money(h)).toEqual([b! - 90, a! - 40]);
    expect(p1(h).supplyReserved).toBe(2);
    h.cmd(1, { type: 'MOVE', units: [mono.id], x: 20 * T, y: 20 * T }); // ignored while it turns
    h.run(catalog.units.get('unit_wl_macrophage')!.trainTicks + 1);
    expect(mono.type).toBe('unit_wl_macrophage');
    expect(mono.maxHp).toBe(220);
    expect(p1(h).supplyReserved).toBe(0);
    expect(p1(h).supplyUsed).toBe(8 + 3);
    expect(h.problems).toEqual([]);
  });
});

describe('construction (gate 4)', () => {
  it('a lymph node orders one building at a time and pays at the order; placing it costs nothing more', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const b0 = p1(h).basic;
    expect(h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_marrow' })).toBe('requirements'); // needs a capillary
    expect(h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' })).toBeNull();
    expect(p1(h).basic).toBe(b0 - 100);
    expect(h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_mitochondria' })).toBe('queue_full');
    // bad sites are refused and the order stays, unpaid again
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 25, ty: 10 })).toBe('too_far');
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 9, ty: 25 })).toBe('site_blocked'); // on the lymph node
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 29, ty: 27 })).toBe('bad_ground'); // on the membrane
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 9, ty: 28 })).toBe('blocks_exit');
    expect(p1(h).basic).toBe(b0 - 100);
    expect(hq.buildOrder).not.toBeNull();
    // two placements in one tick: the first stands, the second finds no order and pays nothing
    h.cmd(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
    h.cmd(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
    h.run(1);
    expect(h.rejected.map((r) => r.reason).at(-1)).toBe('no_order');
    expect(p1(h).basic).toBe(b0 - 100);
    const cap = mine(h.world, 'bld_wl_capillary')[0]!;
    expect(cap.build).not.toBeNull();
    expect(hq.buildOrder).toBeNull();
  });

  it('a building grows from 10% of its hit points to full over its build time, and gives supply only when done', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
    h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
    const cap = mine(h.world, 'bld_wl_capillary')[0]!;
    const def = catalog.buildings.get('bld_wl_capillary')!;
    expect(cap.hp).toBe(Math.floor(def.hp / 10) + Math.floor(((def.hp - Math.floor(def.hp / 10)) * 1000) / (def.buildTicks * 1000)));
    expect(p1(h).supplyCap).toBe(20);
    let builtAt = -1;
    h.run(def.buildTicks + 5, (evs) => {
      if (evs.some((e) => e.type === 'built' && e.entity === cap.id)) builtAt = h.world.tick;
    });
    expect(builtAt).toBe(1 + def.buildTicks); // placed on tick 1; grows from that tick
    expect(cap.hp).toBe(def.hp);
    expect(p1(h).supplyCap).toBe(32);
    expect(h.problems).toEqual([]);
  });

  it('platelets: the first squad speeds growth by half, the second by a quarter, a third adds nothing', () => {
    const times: number[] = [];
    for (const squads of [0, 1, 2, 3]) {
      const h = arenaMatch();
      const hq = hqOf(h.world);
      const helpers = squads ? devUnits(h, 'unit_wl_platelets', squads, 18, 29) : [];
      h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
      h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
      const cap = mine(h.world, 'bld_wl_capillary')[0]!;
      if (helpers.length) h.try(1, { type: 'ASSIST_BUILD', units: helpers.map((u) => u.id), target: cap.id });
      const start = h.world.tick;
      h.run(800, (evs) => evs.some((e) => e.type === 'built'));
      expect(h.problems).toEqual([]);
      times.push(h.world.tick - start);
      h.run(1);
      if (helpers.length) expect(helpers.every((u) => u.job === null)).toBe(true); // they stop once it is done
    }
    console.log(`capillary growth with 0/1/2/3 platelet squads: ${times.join(' / ')} ticks`);
    expect(times[1]).toBeLessThan(times[0]! * 0.75);
    expect(times[2]).toBeLessThan(times[1]!);
    expect(Math.abs(times[3]! - times[2]!)).toBeLessThanOrEqual(1);
  });

  it('cancel and loss: an unplaced order back in full, a growing building 75%, a destroyed one nothing', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    const b0 = p1(h).basic;
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
    expect(h.try(1, { type: 'CANCEL', units: [], building: hq.id, what: 'order', index: 0 })).toBeNull();
    expect(p1(h).basic).toBe(b0);
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
    h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
    const a = mine(h.world, 'bld_wl_capillary')[0]!;
    h.run(50);
    expect(h.try(1, { type: 'CANCEL', units: [], building: a.id, what: 'build', index: 0 })).toBeNull();
    expect(entityById(h.world, a.id)).toBeUndefined();
    expect(p1(h).basic).toBe(b0 - 100 + 75);
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
    h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
    const c = mine(h.world, 'bld_wl_capillary')[0]!;
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [c.id] });
    h.run(2);
    expect(p1(h).basic).toBe(b0 - 100 + 75 - 100);
    expect(h.problems).toEqual([]);
  });

  it('repair is paid over time and waits while money is short', () => {
    const h = arenaMatch();
    const cap = devBuilding(h, 'bld_wl_capillary', 15, 26);
    cap.hp = 100;
    const [squad] = devUnits(h, 'unit_wl_platelets', 1, 18, 29);
    p1(h).basic = 10;
    expect(h.try(1, { type: 'REPAIR', units: [squad!.id], target: cap.id })).toBeNull();
    h.run(200);
    const partial = cap.hp;
    expect(partial).toBeGreaterThan(100);
    expect(partial).toBeLessThan(cap.maxHp);
    expect(p1(h).basic).toBeLessThan(10); // it spent what there was, then waited
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 1000, advanced: 0 });
    const before = p1(h).basic + 1000;
    h.run(800, () => cap.hp === cap.maxHp);
    expect(cap.hp).toBe(cap.maxHp);
    const spent = before - p1(h).basic;
    // the rest of the repair costs about a quarter of the price, in proportion
    expect(spent).toBeGreaterThan(0);
    expect(spent).toBeLessThanOrEqual(Math.ceil((100 * 250 * (cap.maxHp - partial)) / (1000 * cap.maxHp)) + 30);
    h.run(2);
    expect(squad!.job).toBeNull();
    expect(h.problems).toEqual([]);
  });

  it('an outpost goes only where platelets stand; an extractor only on a free deposit, worked once grown', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 2000, advanced: 0 });
    h.run(1);
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_outpost' });
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 8 })).toBe('no_builder');
    devUnits(h, 'unit_wl_platelets', 1, 17, 12);
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 8 })).toBeNull();
    const post = mine(h.world, 'bld_wl_outpost')[0]!;
    expect(post.build).not.toBeNull();
    // extractor
    const dep = h.world.entities.find((e) => e.type === 'res_protein')!;
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_aminopump' });
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 })).toBe('no_deposit');
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 13, ty: 19 })).toBeNull();
    const pump = mine(h.world, 'bld_wl_aminopump')[0]!;
    expect(pump.res!.link).toBe(dep.id);
    const carriers = mine(h.world, 'unit_wl_glut').slice(0, 3).map((e) => e.id);
    expect(h.try(1, { type: 'GATHER', units: carriers, target: pump.id })).toBe('not_ready');
    h.run(catalog.buildings.get('bld_wl_aminopump')!.buildTicks + 2);
    expect(h.try(1, { type: 'GATHER', units: carriers, target: pump.id })).toBeNull();
    h.run(400);
    expect(p1(h).advanced).toBeGreaterThan(0);
    expect(h.problems).toEqual([]);
  });

  it('a building placed across a moving group: they walk around it, nobody ends up inside', () => {
    const h = arenaMatch();
    const hq = hqOf(h.world);
    h.cmd(1, { type: 'DEV_GRANT', units: [], basic: 1000, advanced: 0 });
    const group = devUnits(h, 'unit_wl_neutrophil', 12, 13, 34);
    h.cmd(1, { type: 'MOVE', units: group.map((u) => u.id), x: 22 * T, y: 22 * T });
    h.run(10);
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_marrow' });
    expect(h.rejected.at(-1)?.reason).toBe('requirements');
    h.try(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_mitochondria' });
    // right in their way, with some of them standing on it
    const site = group[0]!;
    const tx = Math.floor(site.x / T) - 1;
    const ty = Math.floor(site.y / T) - 1;
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx, ty })).toBeNull();
    const arrived = new Set<number>();
    h.run(600, (evs) => {
      for (const e of evs) if (e.type === 'arrived') arrived.add(e.entity);
      return arrived.size === group.length;
    });
    expect(h.problems).toEqual([]); // includes: nobody inside a wall or building, every tick
    expect(arrived.size).toBe(group.length);
  });
});

describe('determinism with production and construction', () => {
  it('save in the middle of training and growth: identical to never stopping', async () => {
    const { runHeadless } = await import('../../src/sim/headless');
    const { snapshot, restore } = await import('../../src/sim/core/world');
    const { contextForWorld } = await import('../../src/sim/context');
    const { CommandQueue } = await import('../../src/sim/commands/commands');
    const { arena, newCtx, setup } = await import('./helpers');
    const script = (world: World, tick: number) => {
      const hq = world.entities.find((e) => e.owner === 1 && e.building && e.type === 'bld_wl_lymphnode');
      if (!hq) return [];
      const at = (seq: number, cmd: Parameters<Harness['cmd']>[1]) => [{ player: 1, seq, tick, cmd }];
      if (tick === 0) return at(1, { type: 'TRAIN', units: [], building: hq.id, unit: 'unit_wl_glut', count: 3 });
      if (tick === 5) return at(2, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
      if (tick === 6) return at(3, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 26 });
      if (tick === 200) return at(4, { type: 'CANCEL', units: [], building: hq.id, what: 'queue', index: -1 });
      return [];
    };
    const full = runHeadless(newCtx(), setup, { ticks: 900, script, invariants: true });
    expect(full.problems).toEqual([]);
    const half = runHeadless(newCtx(), setup, { ticks: 250, script });
    expect(half.world.entities.some((e) => e.build !== null)).toBe(true);
    expect(half.world.entities.some((e) => (e.queue?.length ?? 0) > 0)).toBe(true);
    const world = restore(snapshot(half.world));
    const resumed = runHeadless(contextForWorld(catalog, arena, world), setup, { ticks: 650, script, start: world, queue: CommandQueue.fromJSON(half.queue.toJSON()) });
    expect(resumed.finalHash).toBe(full.finalHash);
  });
});
