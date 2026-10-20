// Gate 3 acceptance: gathering, unloading, ATP, saturation. A destroyed depot or crystal
// must never break the game, and resources are conserved through every transition.
import { describe, expect, it } from 'vitest';
import type { Cmd } from '../../src/sim/commands/commands';
import { entityById, spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import type { SimEvent } from '../../src/sim/sim';
import { arenaMatch, asciiMap, catalog, harness, matchOn, type Harness } from './helpers';

const T = 256;

const arena = arenaMatch;

const carriersOf = (w: World, owner: number) => w.entities.filter((e) => e.owner === owner && (catalog.units.get(e.type)?.carry ?? 0) > 0);
const crystals = (w: World, field: number) => w.entities.filter((e) => e.res && e.res.field === field && catalog.resources.has(e.type));
const hqOf = (w: World, owner: number) => w.entities.find((e) => e.owner === owner && catalog.buildings.get(e.type)?.role === 'hq')!;
const stockOf = (es: Entity[]) => es.reduce((s, e) => s + (e.res?.stock ?? 0), 0);
const cargoOf = (w: World, owner: number) => carriersOf(w, owner).reduce((s, e) => s + e.cargo, 0);

/** Glucose a player can account for: still in the ground of `fields`, carried, banked, or lost with dead carriers. */
function glucoseLedger(h: Harness, owner: number, fields: number[], startBasic: number) {
  const ground = fields.reduce((s, f) => s + stockOf(crystals(h.world, f)), 0);
  const lost = h.events.reduce((s, e) => (e.type === 'died' && e.owner === owner ? s + e.cargo : s), 0);
  return ground + cargoOf(h.world, owner) + (h.world.players[owner - 1]!.basic - startBasic) + lost;
}

function addCarriers(h: Harness, owner: number, n: number, x0: number, y0: number): Entity[] {
  const type = owner === 1 ? 'unit_wl_glut' : 'unit_col_feeder';
  return Array.from({ length: n }, (_, k) => spawnUnit(h.world, catalog, type, owner, (x0 + (k % 6)) * T + 128, (y0 + Math.floor(k / 6)) * T + 128));
}

describe('gathering (gate 3)', () => {
  it('the starting carriers spread over the home field and bring in ATP only at unload', () => {
    const h = arena(false);
    const mine = carriersOf(h.world, 1);
    const field = crystals(h.world, 1);
    expect(mine.length).toBe(8);
    expect(field.length).toBe(8);
    const start = h.world.players[0]!.basic;
    const total = glucoseLedger(h, 1, [1], start);
    h.cmd(1, { type: 'GATHER', units: mine.map((e) => e.id), target: field[0]!.id });
    let firstCredit = -1;
    h.run(1, () => {
      // one carrier per crystal: the order spreads them
      expect(new Set(mine.map((e) => e.gather!.target)).size).toBe(8);
    });
    let lastBasic = start;
    h.run(2400, (evs) => {
      const basic = h.world.players[0]!.basic;
      const credited = evs.filter((e) => e.type === 'delivered').reduce((s, e) => s + (e.type === 'delivered' ? e.amount : 0), 0);
      // money changes only by what was unloaded this tick
      expect(basic - lastBasic).toBe(credited);
      if (credited > 0 && firstCredit < 0) firstCredit = h.world.tick;
      lastBasic = basic;
      expect(glucoseLedger(h, 1, [1], start)).toBe(total);
    });
    expect(h.problems).toEqual([]);
    expect(h.stopped()).toEqual([]);
    expect(firstCredit).toBeGreaterThan(100); // a full harvest (5 s) comes before the first ATP
    const perCarrierPerSecond = (h.world.players[0]!.basic - start) / 8 / 120;
    expect(perCarrierPerSecond).toBeGreaterThan(1.0);
    expect(perCarrierPerSecond).toBeLessThan(1.6);
    console.log(`8 carriers on 8 crystals: ${perCarrierPerSecond.toFixed(2)} ATP/s each; first ATP at tick ${firstCredit}`);
  });

  it('saturation: two carriers per crystal is the useful maximum', () => {
    const rates: number[] = [];
    for (const n of [8, 16, 24]) {
      const h = arena(false);
      addCarriers(h, 1, n - 8, 12, 30);
      const mine = carriersOf(h.world, 1);
      h.cmd(1, { type: 'GATHER', units: mine.map((e) => e.id), target: crystals(h.world, 1)[0]!.id });
      h.run(600);
      const before = h.world.players[0]!.basic;
      h.run(1800);
      expect(h.problems).toEqual([]);
      rates.push((h.world.players[0]!.basic - before) / 90);
    }
    console.log(`income at 8 / 16 / 24 carriers: ${rates.map((r) => r.toFixed(1)).join(' / ')} ATP/s`);
    expect(rates[1]! / rates[0]!).toBeGreaterThan(1.4); // the second carrier per crystal still pays
    expect(rates[2]! / rates[1]!).toBeLessThan(1.05); // the third adds nothing
  });

  it('twenty carriers on several fields, both players: every unit of glucose accounted for, none credited twice', () => {
    const h = arena(false);
    addCarriers(h, 1, 12, 12, 30); // 8 + 12 = 20
    const mine = carriersOf(h.world, 1);
    const theirs = carriersOf(h.world, 2);
    const s1 = h.world.players[0]!.basic;
    const s2 = h.world.players[1]!.basic;
    const t1 = glucoseLedger(h, 1, [1, 3], s1);
    const t2 = glucoseLedger(h, 2, [2], s2);
    h.cmd(1, { type: 'GATHER', units: mine.slice(0, 14).map((e) => e.id), target: crystals(h.world, 1)[0]!.id });
    h.cmd(1, { type: 'GATHER', units: mine.slice(14).map((e) => e.id), target: crystals(h.world, 3)[0]!.id });
    h.cmd(2, { type: 'GATHER', units: theirs.map((e) => e.id), target: crystals(h.world, 2)[0]!.id });
    h.run(3000, () => {
      expect(glucoseLedger(h, 1, [1, 3], s1)).toBe(t1);
      expect(glucoseLedger(h, 2, [2], s2)).toBe(t2);
    });
    expect(h.problems).toEqual([]);
    expect(h.world.players[0]!.basic - s1).toBe(h.delivered(1));
    expect(h.world.players[1]!.basic - s2).toBe(h.delivered(2));
    expect(h.delivered(1)).toBeGreaterThan(2000);
    expect(h.delivered(2)).toBeGreaterThan(1000);
    // the far field is worked too, and pays less per carrier without a depot
    const north = crystals(h.world, 3);
    expect(stockOf(north)).toBeLessThan(2 * 1800 + 3 * 600);
  });

  it('a crystal running dry under two carriers: nobody takes more than is left', () => {
    // one crystal near the HQ with 15 left; another one 9 tiles away, in a field of its own
    const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 34 }, (_, x) => (x === 0 || y === 0 || x === 33 || y === 15 ? '#' : '.')).join(''));
    const map = asciiMap('dry', rows, [], [
      { type: 'res_glucose_small', tile: [8, 3], field: 1 },
      { type: 'res_glucose_small', tile: [8, 12], field: 2 },
    ]);
    const { ctx, world } = matchOn(map);
    const h = harness(world, ctx);
    const c = crystals(world, 1)[0]!;
    const other = crystals(world, 2)[0]!;
    c.res!.stock = 15;
    const [a, b] = carriersOf(world, 1);
    h.cmd(1, { type: 'GATHER', units: [a!.id, b!.id], target: c.id });
    // every load taken, with the crystal it came from
    const takes: { who: number; amount: number; from: number }[] = [];
    const last = new Map([[a!.id, 0], [b!.id, 0]]);
    h.run(800, () => {
      expect(c.res!.stock).toBeGreaterThanOrEqual(0);
      for (const u of [a!, b!]) {
        if (u.cargo > 0 && last.get(u.id) === 0) takes.push({ who: u.id, amount: u.cargo, from: u.gather!.target });
        last.set(u.id, u.cargo);
      }
    });
    expect(h.problems).toEqual([]);
    expect(entityById(world, c.id)).toBeUndefined(); // emptied crystals leave the map
    expect(h.events.some((e) => e.type === 'died' && e.entity === c.id && e.cause === 'depleted')).toBe(true);
    // 15 in the ground, one slot: a load of 10, then one of 5, never more; then both move on
    expect(takes.filter((t) => t.from === c.id).map((t) => t.amount)).toEqual([10, 5]);
    expect(a!.gather?.target).toBe(other.id);
    expect(b!.gather?.target).toBe(other.id);
    expect(h.delivered(1) + a!.cargo + b!.cargo).toBe(15 + 600 - other.res!.stock);
  });

  it('three slots on an extractor; two loads finishing on the same tick share what is left', () => {
    const h = arena();
    const dep = h.world.entities.find((e) => e.type === 'res_protein')!;
    h.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_aminopump', count: 1, x: dep.x, y: dep.y });
    h.run(1);
    const pump = h.world.entities.find((e) => e.type === 'bld_wl_aminopump')!;
    expect(pump.res!.link).toBe(dep.id);
    expect(dep.res!.link).toBe(pump.id);
    const crew = addCarriers(h, 1, 5, 12, 30);
    // the order may name the deposit; it is worked through the extractor on top
    h.cmd(1, { type: 'GATHER', units: crew.map((e) => e.id), target: dep.id });
    let most = 0;
    h.run(600, () => {
      const harvesting = crew.filter((e) => e.gather?.st === 'harvest').length;
      most = Math.max(most, harvesting);
      expect(harvesting).toBeLessThanOrEqual(3);
    });
    expect(h.problems).toEqual([]);
    expect(most).toBe(3);
    expect(h.world.players[0]!.advanced).toBe(h.delivered(1, 'protein'));
    expect(h.world.players[0]!.advanced).toBeGreaterThan(0);
    // now leave 15 in the deposit and make two harvests end on the same tick
    h.run(400, () => crew.filter((e) => e.gather?.st === 'harvest').length >= 2);
    const two = crew.filter((e) => e.gather?.st === 'harvest').slice(0, 2);
    expect(two.length).toBe(2);
    for (const e of crew) if (e.gather?.st === 'harvest' && !two.includes(e)) e.gather.until += 1000;
    dep.res!.stock = 15;
    const amino = h.world.players[0]!.advanced;
    const carried = crew.reduce((s, e) => s + e.cargo, 0);
    const end = h.world.tick + 3;
    for (const e of two) e.gather!.until = end;
    h.run(4);
    expect(two.map((e) => e.cargo)).toEqual([10, 5]); // lower id first, never past the stock
    expect(entityById(h.world, dep.id)).toBeUndefined();
    expect(pump.res!.link).toBe(0);
    h.run(600);
    expect(h.problems).toEqual([]);
    // everything that left the ground arrived; nothing more came from the empty deposit
    expect(h.world.players[0]!.advanced - amino).toBe(carried + 15 - crew.reduce((s, e) => s + e.cargo, 0));
    for (const e of crew) expect(e.gather).toBeNull();
    expect(h.stopped().filter((s) => crew.some((c) => c.id === s.entity)).every((s) => s.reason === 'depleted')).toBe(true);
  });

  it('a depot destroyed mid-trip: carriers turn to the next; with none left they wait holding their loads; the game goes on', () => {
    const h = arena();
    const north = crystals(h.world, 3);
    // a bone marrow (critical) keeps the White Line in the game when its lymph node falls later
    h.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_marrow', count: 1, x: 18 * T + 128, y: 33 * T + 128 });
    h.run(1);
    // a mitochondria next to the far field shortens the trip
    h.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_mitochondria', count: 1, x: 16 * T + 128, y: 10 * T + 128 });
    h.run(1);
    const mito = h.world.entities.find((e) => e.type === 'bld_wl_mitochondria')!;
    expect(mito).toBeDefined();
    const crew = addCarriers(h, 1, 6, 12, 14);
    h.cmd(1, { type: 'GATHER', units: crew.map((e) => e.id), target: north[0]!.id });
    h.run(1200, () => crew.filter((e) => e.gather?.st === 'toDrop' && e.gather.drop === mito.id).length >= 2);
    const enRoute = crew.filter((e) => e.gather?.st === 'toDrop' && e.gather.drop === mito.id);
    expect(enRoute.length).toBeGreaterThanOrEqual(2);
    const hq = hqOf(h.world, 1);
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [mito.id] });
    h.run(2);
    expect(entityById(h.world, mito.id)).toBeUndefined();
    for (const e of enRoute) expect(e.gather?.drop).toBe(hq.id); // the HQ is the next dropoff
    const atHq = () => h.events.filter((e) => e.type === 'delivered' && e.dropoff === hq.id && enRoute.some((c) => c.id === e.entity)).length;
    h.run(900, () => atHq() >= enRoute.length);
    expect(atHq()).toBeGreaterThanOrEqual(enRoute.length);

    // now the last dropoff goes too
    h.run(400, () => crew.some((e) => e.cargo > 0));
    const basic = h.world.players[0]!.basic;
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [hq.id] });
    h.run(600);
    expect(h.problems).toEqual([]);
    expect(h.world.players[0]!.basic).toBe(basic); // nothing banked without a dropoff
    const waiting = crew.filter((e) => e.cargo > 0);
    expect(waiting.length).toBeGreaterThan(0);
    for (const e of waiting) {
      expect(e.gather).toBeNull(); // stopped, with the reason reported, holding the load
      expect(h.stopped().some((s) => s.entity === e.id && s.reason === 'no_dropoff')).toBe(true);
    }
    // a new depot, a new order: the held loads come in first
    h.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_mitochondria', count: 1, x: 25 * T + 128, y: 9 * T + 128 });
    h.run(1);
    h.cmd(1, { type: 'GATHER', units: crew.map((e) => e.id), target: north[1]!.id });
    h.run(600);
    expect(h.problems).toEqual([]);
    expect(h.world.players[0]!.basic).toBeGreaterThanOrEqual(basic + waiting.length * 10);
  });

  it('a crystal destroyed while harvested: the slot is released and the carrier moves to another', () => {
    const h = arena();
    const mine = carriersOf(h.world, 1);
    h.cmd(1, { type: 'GATHER', units: mine.map((e) => e.id), target: crystals(h.world, 1)[0]!.id });
    h.run(400, () => mine.some((e) => e.gather?.st === 'harvest'));
    const c = mine.find((e) => e.gather?.st === 'harvest')!;
    const target = c.gather!.target;
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [target] });
    h.run(3);
    expect(entityById(h.world, target)).toBeUndefined();
    expect(c.gather).not.toBeNull();
    expect(c.gather!.target).not.toBe(target);
    h.run(600);
    expect(h.problems).toEqual([]);
    expect(h.stopped()).toEqual([]);
  });

  it('a field running out: carriers take what is left, then stop and say why', () => {
    const h = arena();
    const north = crystals(h.world, 3);
    for (const c of north) c.res!.stock = 20;
    const crew = addCarriers(h, 1, 4, 12, 9);
    const before = h.world.players[0]!.basic;
    h.cmd(1, { type: 'GATHER', units: crew.map((e) => e.id), target: north[0]!.id });
    h.run(3000, () => crew.every((e) => e.gather === null));
    expect(h.problems).toEqual([]);
    for (const c of north) expect(entityById(h.world, c.id)).toBeUndefined();
    expect(h.world.players[0]!.basic - before).toBe(20 * north.length);
    for (const e of crew) {
      expect(e.gather).toBeNull();
      expect(e.cargo).toBe(0);
    }
    const reasons = h.stopped().filter((s) => crew.some((c) => c.id === s.entity)).map((s) => s.reason);
    expect(reasons.length).toBe(crew.length);
    expect(new Set(reasons)).toEqual(new Set(['depleted']));
  });

  it('a carrier killed with a load: the load is lost, never credited, and its slot is free again', () => {
    const h = arena();
    const mine = carriersOf(h.world, 1);
    h.cmd(1, { type: 'GATHER', units: mine.map((e) => e.id), target: crystals(h.world, 1)[0]!.id });
    h.run(400, () => mine.some((e) => e.gather?.st === 'toDrop' && e.cargo > 0) && mine.some((e) => e.gather?.st === 'harvest'));
    const loaded = mine.find((e) => e.gather?.st === 'toDrop' && e.cargo > 0)!;
    const working = mine.find((e) => e.gather?.st === 'harvest')!;
    const slotOf = working.gather!.target;
    const basic = h.world.players[0]!.basic;
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [loaded.id, working.id] });
    h.run(1);
    const died = h.events.find((e) => e.type === 'died' && e.entity === loaded.id);
    expect(died && died.type === 'died' ? died.cargo : -1).toBe(10);
    expect(h.world.players[0]!.basic).toBe(basic);
    expect(entityById(h.world, slotOf)!.res!.slots).not.toContain(working.id);
    h.run(200);
    expect(h.problems).toEqual([]);
  });

  it('another order frees the slot; the carrier keeps its load and can return it to a dropoff', () => {
    const h = arena();
    const mine = carriersOf(h.world, 1);
    h.cmd(1, { type: 'GATHER', units: mine.map((e) => e.id), target: crystals(h.world, 1)[0]!.id });
    h.run(400, () => mine.some((e) => e.gather?.st === 'harvest'));
    const c = mine.find((e) => e.gather?.st === 'harvest')!;
    const t = entityById(h.world, c.gather!.target)!;
    h.cmd(1, { type: 'MOVE', units: [c.id], x: 20 * T, y: 36 * T });
    h.run(1);
    expect(c.gather).toBeNull();
    expect(t.res!.slots).not.toContain(c.id);
    // a carrier with a load, sent to its HQ: it unloads and then stands idle
    h.run(300, () => mine.some((e) => e.gather?.st === 'toDrop' && e.cargo > 0));
    const d = mine.find((e) => e.gather?.st === 'toDrop' && e.cargo > 0)!;
    h.cmd(1, { type: 'MOVE', units: [d.id], x: 20 * T, y: 36 * T });
    h.run(120);
    expect(d.cargo).toBe(10);
    const hq = hqOf(h.world, 1);
    h.cmd(1, { type: 'GATHER', units: [d.id], target: hq.id });
    h.run(400, () => d.cargo === 0);
    expect(d.cargo).toBe(0);
    h.run(2);
    expect(d.gather).toBeNull();
    expect(d.order.kind).toBe('idle');
    expect(h.problems).toEqual([]);
  });

  it('an unreachable crystal: the carrier gives up with a reason instead of trying forever', () => {
    const rows: string[] = [];
    for (let y = 0; y < 16; y++) {
      let r = '';
      for (let x = 0; x < 34; x++) {
        const border = x === 0 || y === 0 || x === 33 || y === 15;
        const room = x >= 18 && x <= 24 && y >= 8 && y <= 14 && (x === 18 || x === 24 || y === 8 || y === 14);
        r += border || room ? '#' : '.';
      }
      rows.push(r);
    }
    const map = asciiMap('sealed', rows, [], [{ type: 'res_glucose_large', tile: [20, 10], field: 1 }]);
    const { ctx, world } = matchOn(map);
    const h = harness(world, ctx);
    const mine = carriersOf(world, 1);
    const c = crystals(world, 1)[0]!;
    h.cmd(1, { type: 'GATHER', units: [mine[0]!.id], target: c.id });
    h.run(3000, () => mine[0]!.gather === null);
    expect(h.problems).toEqual([]);
    expect(mine[0]!.gather).toBeNull();
    expect(h.stopped().map((s) => s.reason)).toEqual(['path_blocked']);
  });
});

describe('GATHER validation', () => {
  function rejection(prep: (h: Harness) => Cmd): string | null {
    const h = arena();
    const cmd = prep(h);
    h.cmd(1, cmd);
    h.run(1);
    const r = h.events.find((e) => e.type === 'rejected');
    return r && r.type === 'rejected' ? r.rejection.reason : null;
  }
  const ids = (h: Harness) => carriersOf(h.world, 1).map((e) => e.id);

  it('accepts crystals, own extractors and own dropoffs', () => {
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: crystals(h.world, 1)[0]!.id }))).toBeNull();
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: hqOf(h.world, 1).id }))).toBeNull();
  });
  it('rejects unknown targets, enemies, deposits without an extractor, and lists without carriers', () => {
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: 99999 }))).toBe('unknown_target');
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: hqOf(h.world, 2).id }))).toBe('not_owner');
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: h.world.entities.find((e) => e.type === 'res_protein')!.id }))).toBe('no_extractor');
    expect(rejection((h) => ({ type: 'GATHER', units: ids(h), target: carriersOf(h.world, 1)[0]!.id }))).toBe('bad_target');
    expect(rejection((h) => ({ type: 'GATHER', units: h.world.entities.filter((e) => e.type === 'unit_wl_monocyte').map((e) => e.id), target: crystals(h.world, 1)[0]!.id }))).toBe('no_carriers');
  });
  it('rejects an enemy extractor', () => {
    expect(
      rejection((h) => {
        const iron = h.world.entities.find((e) => e.type === 'res_iron')!;
        h.cmd(2, { type: 'DEV_SPAWN', units: [], unit: 'bld_col_siderophore', count: 1, x: iron.x, y: iron.y });
        h.run(1);
        return { type: 'GATHER', units: ids(h), target: iron.id };
      }),
    ).toBe('not_owner');
  });
  it('dev commands only in test matches; a building site must be free', () => {
    const h = arena(false);
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [hqOf(h.world, 2).id] });
    h.run(1);
    expect(h.problems).toEqual(['tick 0: rejected not_a_dev_match']);
    const d = arena();
    d.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_mitochondria', count: 1, x: 9 * T, y: 25 * T }); // on the HQ
    d.run(1);
    expect(d.problems).toEqual(['tick 0: rejected site_blocked']);
  });
});
