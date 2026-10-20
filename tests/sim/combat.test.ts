// Gate 5 acceptance: a full fight against a passive opponent, with no information leaking
// through what a player can see. Plus every combat rule written in the architecture.
import { describe, expect, it } from 'vitest';
import { damageOf, LEASH } from '../../src/sim/combat/combat';
import { checkPlacement } from '../../src/sim/build/placement';
import { entityById, spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import type { SimEvent } from '../../src/sim/sim';
import { canSee, exploredBit } from '../../src/sim/vision/vision';
import { arenaMatch, asciiMap, catalog, harness, matchOn, type Harness } from './helpers';

const T = 256;
const W = (id: string) => catalog.weapons.get(id)!;

/** An open 48x24 test field; both sides' starting units removed, dev commands on. */
function field(): Harness {
  const rows = Array.from({ length: 24 }, (_, y) => Array.from({ length: 48 }, (_, x) => (x === 0 || y === 0 || x === 47 || y === 23 ? '#' : '.')).join(''));
  const { ctx, world } = matchOn(asciiMap('field', rows), 5);
  world.dev = true;
  const h = harness(world, ctx);
  h.cmd(1, { type: 'DEV_KILL', units: [], targets: world.entities.filter((e) => !e.building && e.owner === 1).map((e) => e.id) });
  h.cmd(2, { type: 'DEV_KILL', units: [], targets: world.entities.filter((e) => !e.building && e.owner === 2).map((e) => e.id) });
  h.run(1);
  return h;
}

const put = (h: Harness, type: string, owner: number, tx: number, ty: number): Entity => spawnUnit(h.world, catalog, type, owner, tx * T + 128, ty * T + 128);
const launches = (evs: SimEvent[], id: number) => evs.filter((e): e is Extract<SimEvent, { type: 'launched' }> => e.type === 'launched' && e.entity === id);
const hits = (evs: SimEvent[], target: number) => evs.filter((e): e is Extract<SimEvent, { type: 'hit' }> => e.type === 'hit' && e.target === target);

describe('combat rules (gate 5)', () => {
  it('a melee attack winds up, lands on its launch tick, and the cooldown runs from each launch', () => {
    const h = field();
    const n = put(h, 'unit_wl_neutrophil', 1, 20, 12);
    const c = put(h, 'unit_col_coccus', 2, 21, 12);
    c.hp = 10_000; // a sturdy target, to watch several swings
    c.maxHp = 10_000;
    h.cmd(1, { type: 'ATTACK', units: [n.id], target: c.id });
    h.run(80);
    const l = launches(h.events, n.id).map((e) => e.tick);
    const w = W('w_neutrophil_claw');
    expect(l[0]).toBe(1 + w.windup - 1 + 1); // ordered on tick 1, winds up from tick 1, launches 4 ticks later
    for (let k = 1; k < l.length; k++) expect(l[k]! - l[k - 1]!).toBe(w.cooldown);
    // each launch landed the same tick, for the claw's damage
    for (const t of l) expect(hits(h.events, c.id).some((e) => e.tick === t && e.amount === 8)).toBe(true);
  });

  it('moving away mid-windup: no shot, and the cooldown is neither reset nor skipped', () => {
    const h = field();
    const n = put(h, 'unit_wl_neutrophil', 1, 20, 12);
    const c = put(h, 'unit_col_coccus', 2, 21, 12);
    c.hp = c.maxHp = 10_000;
    const w = W('w_neutrophil_claw');
    h.cmd(1, { type: 'ATTACK', units: [n.id], target: c.id });
    h.run(30, () => launches(h.events, n.id).length === 1);
    const first = launches(h.events, n.id)[0]!.tick;
    // the next windup starts at first + cooldown − windup; interrupt it one tick in
    h.run(w.cooldown - w.windup); // now winding up
    expect(n.cb!.windupEnd).toBeGreaterThan(h.world.tick - 1);
    h.cmd(1, { type: 'MOVE', units: [n.id], x: 20 * T + 128, y: 12 * T + 128 });
    h.run(1);
    expect(n.cb!.windupEnd).toBe(-1);
    expect(n.cb!.nextLaunch).toBe(first + w.cooldown); // untouched
    h.cmd(1, { type: 'ATTACK', units: [n.id], target: c.id });
    const again = h.world.tick;
    h.run(40);
    const next = launches(h.events, n.id)[1]!.tick;
    expect(next).toBeGreaterThan(first + w.cooldown); // the interrupted swing never landed
    expect(next).toBe(Math.max(first + w.cooldown, again + w.windup)); // a full windup again, no free shot
  });

  it('damage: the best bonus for the target, minus its armor, never below 1', () => {
    const eos = W('w_eos_granule');
    const macro = { ...put(field(), 'unit_wl_macrophage', 1, 5, 5) };
    const coccus = { ...put(field(), 'unit_col_coccus', 2, 5, 5) };
    const h = field();
    const core = h.world.entities.find((e) => e.type === 'bld_col_biofilm_core')!;
    expect(damageOf(h.ctx, eos, macro)).toBe(12 * 2 - 2); // armored ×2, armor 2
    expect(damageOf(h.ctx, eos, core)).toBe(Math.floor((12 * 2 * 750) / 1000) - 1); // building ×2, on its own biofilm ×0.75, armor 1
    expect(damageOf(h.ctx, eos, coccus)).toBe(12);
    expect(damageOf(h.ctx, W('w_monocyte_nip'), macro)).toBe(2);
    expect(damageOf(h.ctx, { ...W('w_monocyte_nip'), damage: 1 }, macro)).toBe(1);
  });

  it('projectiles fly; a granule whose target dies first is gone, a toxin glob lands where the target was', () => {
    const h = field();
    const e = put(h, 'unit_wl_eosinophil', 1, 10, 12);
    const c = put(h, 'unit_col_coccus', 2, 13, 12);
    c.hp = c.maxHp = 1000;
    h.cmd(1, { type: 'HOLD', units: [c.id] });
    h.cmd(1, { type: 'ATTACK', units: [e.id], target: c.id });
    h.run(30, () => launches(h.events, e.id).length === 1);
    const l = launches(h.events, e.id)[0]!;
    expect(l.impact).toBeGreaterThan(l.tick); // a flight, not an instant hit
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [c.id] });
    h.run(l.impact - h.world.tick + 2);
    expect(hits(h.events, c.id).length).toBe(0);
    // a toxin glob: its target dies in flight, it still lands and splashes the one standing next to it
    const g = field();
    const tox = put(g, 'unit_col_toxin', 2, 10, 12);
    const a = put(g, 'unit_wl_neutrophil', 1, 18, 12);
    const b = put(g, 'unit_wl_neutrophil', 1, 18, 13);
    for (const u of [a, b]) u.hp = u.maxHp = 1000;
    g.cmd(1, { type: 'HOLD', units: [a.id, b.id] });
    g.cmd(2, { type: 'ATTACK', units: [tox.id], target: a.id });
    g.run(60, () => launches(g.events, tox.id).length === 1);
    g.cmd(1, { type: 'DEV_KILL', units: [], targets: [a.id] });
    g.run(launches(g.events, tox.id)[0]!.impact - g.world.tick + 2);
    expect(hits(g.events, b.id).length).toBe(1);
    expect(g.problems).toEqual([]);
  });

  it('engulf swallows a small target whole, then the macrophage digests', () => {
    const h = field();
    const m = put(h, 'unit_wl_macrophage', 1, 20, 12);
    const c = put(h, 'unit_col_coccus', 2, 21, 12);
    const big = put(h, 'unit_col_strep', 2, 20, 14);
    h.cmd(2, { type: 'HOLD', units: [c.id, big.id] });
    h.cmd(1, { type: 'ATTACK', units: [m.id], target: c.id });
    h.run(20, () => !entityById(h.world, c.id));
    expect(entityById(h.world, c.id)).toBeUndefined();
    const ate = h.events.find((e) => e.type === 'engulfed');
    expect(ate).toBeDefined();
    const w = W('w_macro_engulf');
    expect(m.cb!.nextLaunch).toBeGreaterThanOrEqual(ate!.tick + w.cooldown * 3);
    // a big one is not swallowed: plain damage
    h.cmd(1, { type: 'ATTACK', units: [m.id], target: big.id });
    h.run(200, () => hits(h.events, big.id).length > 0);
    expect(hits(h.events, big.id)[0]!.amount).toBe(16 - 1);
    expect(entityById(h.world, big.id)).toBeDefined();
  });

  it('splash hurts only the other side; histamine slows', () => {
    const h = field();
    h.cmd(1, { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_mastcell', count: 1, x: 12 * T + 128, y: 12 * T + 128 });
    h.run(1);
    const tower = h.world.entities.find((e) => e.type === 'bld_wl_mastcell')!;
    const foe = put(h, 'unit_col_coccus', 2, 16, 12);
    const friend = put(h, 'unit_wl_neutrophil', 1, 16, 14); // inside the splash, out of the coccus's reach
    foe.hp = foe.maxHp = 1000;
    h.cmd(1, { type: 'HOLD', units: [friend.id] });
    h.cmd(2, { type: 'HOLD', units: [foe.id] });
    h.run(40);
    expect(launches(h.events, tower.id).length).toBeGreaterThan(0);
    expect(hits(h.events, foe.id).length).toBeGreaterThan(0);
    expect(hits(h.events, friend.id).length).toBe(0);
    expect(foe.slow?.pct).toBe(400);
    // a slowed unit walks at 60%
    const start = foe.x;
    h.cmd(2, { type: 'MOVE', units: [foe.id], x: 40 * T, y: 12 * T });
    h.run(20);
    const slowed = foe.x - start;
    const g = field();
    const free = put(g, 'unit_col_coccus', 2, 16, 12);
    g.cmd(2, { type: 'MOVE', units: [free.id], x: 40 * T, y: 12 * T });
    g.run(21);
    expect(slowed).toBeLessThan((free.x - 16 * T - 128) * 0.8);
  });

  it('an arc sweep hits up to three in front of the attacker', () => {
    const h = field();
    const s = put(h, 'unit_col_strep', 2, 20, 12);
    const ring = [put(h, 'unit_wl_neutrophil', 1, 22, 11), put(h, 'unit_wl_neutrophil', 1, 22, 12), put(h, 'unit_wl_neutrophil', 1, 22, 13), put(h, 'unit_wl_neutrophil', 1, 18, 12)];
    for (const u of ring) u.hp = u.maxHp = 1000;
    h.cmd(1, { type: 'HOLD', units: ring.map((u) => u.id) });
    h.cmd(2, { type: 'ATTACK', units: [s.id], target: ring[1]!.id });
    h.run(40, () => launches(h.events, s.id).length === 1);
    h.run(1);
    const swing = launches(h.events, s.id)[0]!.tick;
    const struck = h.events.filter((e) => e.type === 'hit' && e.entity === s.id && e.tick === swing).map((e) => (e.type === 'hit' ? e.target : 0));
    expect(struck.length).toBeGreaterThan(1);
    expect(struck.length).toBeLessThanOrEqual(3);
    expect(struck).toContain(ring[1]!.id);
    expect(struck).not.toContain(ring[3]!.id); // behind it
  });

  it('two units can kill each other on the same tick', () => {
    const h = field();
    const n = put(h, 'unit_wl_neutrophil', 1, 20, 12);
    const c = put(h, 'unit_col_coccus', 2, 21, 12);
    n.hp = 1;
    c.hp = 1;
    h.cmd(1, { type: 'ATTACK', units: [n.id], target: c.id });
    h.cmd(2, { type: 'ATTACK', units: [c.id], target: n.id });
    h.run(10);
    const deaths = h.events.filter((e) => e.type === 'died' && (e.entity === n.id || e.entity === c.id));
    expect(deaths.length).toBe(2);
    expect(deaths[0]!.tick).toBe(deaths[1]!.tick);
  });

  it('a target is kept while it makes sense; the player’s order wins', () => {
    const h = field();
    const n = put(h, 'unit_wl_neutrophil', 1, 20, 12);
    const a = put(h, 'unit_col_coccus', 2, 22, 12);
    const b = put(h, 'unit_col_coccus', 2, 23, 14);
    for (const u of [a, b]) u.hp = u.maxHp = 1000;
    h.cmd(2, { type: 'HOLD', units: [a.id, b.id] });
    h.run(12);
    expect(n.cb!.target).toBe(a.id); // the nearer one
    const seen = new Set<number>();
    h.run(60, () => void seen.add(n.cb!.target));
    expect([...seen]).toEqual([a.id]); // no hopping between targets
    h.cmd(1, { type: 'ATTACK', units: [n.id], target: b.id });
    h.run(3);
    expect(n.cb!.target).toBe(b.id);
  });

  it('hold fires without moving; move only moves; an idle unit chases no further than its leash', () => {
    const h = field();
    const e = put(h, 'unit_wl_eosinophil', 1, 10, 12);
    const c = put(h, 'unit_col_coccus', 2, 17, 12);
    c.hp = c.maxHp = 1000;
    h.cmd(1, { type: 'HOLD', units: [e.id] });
    h.cmd(2, { type: 'HOLD', units: [c.id] });
    const x0 = e.x;
    h.run(60);
    expect(e.x).toBe(x0); // out of range (4 tiles): it waits
    expect(launches(h.events, e.id).length).toBe(0);
    // a moving unit walks past an enemy without a blow
    const n = put(h, 'unit_wl_neutrophil', 1, 15, 14);
    h.cmd(1, { type: 'MOVE', units: [n.id], x: 30 * T, y: 13 * T });
    h.run(120);
    expect(launches(h.events, n.id).length).toBe(0);
    // an idle unit chases a fleeing enemy, then walks back
    const g = field();
    const guard = put(g, 'unit_wl_neutrophil', 1, 10, 12);
    const runner = put(g, 'unit_col_flagellate', 2, 14, 12);
    runner.hp = runner.maxHp = 5000;
    g.run(10);
    expect(guard.cb!.target).toBe(runner.id);
    g.cmd(2, { type: 'MOVE', units: [runner.id], x: 44 * T, y: 12 * T });
    let farthest = 0;
    g.run(300, () => void (farthest = Math.max(farthest, guard.x - (10 * T + 128))));
    expect(farthest).toBeLessThanOrEqual(LEASH + 2 * T);
    expect(Math.abs(guard.x - (10 * T + 128))).toBeLessThan(2 * T); // back where it started
    expect(g.problems).toEqual([]);
  });

  it('attack-move fights what it meets and then goes on to the point', () => {
    const h = field();
    const group = [0, 1, 2, 3, 4, 5].map((k) => put(h, 'unit_wl_neutrophil', 1, 6 + (k % 2), 10 + k));
    const foes = [put(h, 'unit_col_coccus', 2, 22, 12), put(h, 'unit_col_coccus', 2, 22, 13)];
    h.cmd(2, { type: 'HOLD', units: foes.map((f) => f.id) });
    h.cmd(1, { type: 'ATTACK_MOVE', units: group.map((u) => u.id), x: 38 * T, y: 12 * T });
    h.run(900, () => group.every((u) => u.hp <= 0 || u.order.kind === 'idle'));
    expect(foes.every((f) => !entityById(h.world, f.id))).toBe(true);
    const alive = group.filter((u) => entityById(h.world, u.id));
    expect(alive.length).toBeGreaterThan(3);
    for (const u of alive) expect(u.x).toBeGreaterThan(34 * T);
    expect(h.problems).toEqual([]);
  });

  it('victory when the last critical building of the other side falls; a draw when both fall on one tick', () => {
    const h = field();
    const [a, b] = [h.world.entities.find((e) => e.type === 'bld_wl_lymphnode')!, h.world.entities.find((e) => e.type === 'bld_col_biofilm_core')!];
    h.cmd(1, { type: 'DEV_KILL', units: [], targets: [a.id, b.id] });
    h.run(1);
    expect(h.world.outcome).toEqual({ winnerTeam: 0, tick: 1 });
    expect(h.world.players.every((p) => p.defeated)).toBe(true);
    const g = field();
    g.cmd(1, { type: 'DEV_KILL', units: [], targets: [g.world.entities.find((e) => e.type === 'bld_col_biofilm_core')!.id] });
    g.run(1);
    expect(g.world.outcome?.winnerTeam).toBe(1);
    expect(g.events.some((e) => e.type === 'match_over')).toBe(true);
    // the beaten side's orders are refused from then on
    const left = put(g, 'unit_col_coccus', 2, 30, 12);
    expect(g.try(2, { type: 'MOVE', units: [left.id], x: 10 * T, y: 10 * T })).toBe('player_defeated');
  });
});

describe('vision and fog (gate 5)', () => {
  it('each tile is unexplored, explored or visible, per player; explored stays explored', () => {
    const h = arenaMatch();
    h.run(1);
    const v = h.ctx.vision;
    const hq1 = h.world.entities.find((e) => e.type === 'bld_wl_lymphnode')!;
    const hq2 = h.world.entities.find((e) => e.type === 'bld_col_biofilm_core')!;
    const tile = (e: Entity) => [Math.floor(e.x / T), Math.floor(e.y / T)] as const;
    expect(v.sees(1, ...tile(hq1))).toBe(true);
    expect(v.sees(1, ...tile(hq2))).toBe(false);
    expect(exploredBit(h.world, 1, tile(hq2)[1] * 104 + tile(hq2)[0])).toBe(false);
    // a scout goes and comes back: what it saw stays explored, but no longer visible
    const scout = h.world.entities.find((e) => e.type === 'unit_wl_monocyte')!;
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 46 * T, y: 26 * T });
    h.run(400, () => scout.order.kind === 'idle');
    const mid = [52, 26] as const;
    expect(v.sees(1, ...mid)).toBe(true);
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 14 * T, y: 30 * T });
    h.run(400, () => scout.order.kind === 'idle');
    expect(v.sees(1, ...mid)).toBe(false);
    expect(exploredBit(h.world, 1, mid[1] * 104 + mid[0])).toBe(true);
  });

  it('what moves, builds or dies out of sight leaks nothing: not to orders, targeting, memory or placement', () => {
    const h = arenaMatch();
    const scout = h.world.entities.find((e) => e.type === 'unit_wl_monocyte')!;
    const core = h.world.entities.find((e) => e.type === 'bld_col_biofilm_core')!;
    // an enemy out of sight: an order to attack it reads like one at nothing at all
    const hidden = spawnUnit(h.world, catalog, 'unit_col_coccus', 2, 70 * T, 30 * T);
    h.run(1);
    expect(canSee(h.ctx, 1, hidden)).toBe(false);
    expect(h.try(1, { type: 'ATTACK', units: [scout.id], target: hidden.id })).toBe('unknown_target');
    expect(h.try(1, { type: 'ATTACK', units: [scout.id], target: 99999 })).toBe('unknown_target');
    expect(h.world.memory[0]!.some((m) => m.id === core.id)).toBe(false); // never seen
    // the scout sees the Colony's core: it is remembered as it was
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 82 * T, y: 22 * T });
    h.run(600, () => canSee(h.ctx, 1, core));
    h.run(2);
    const seen = h.world.memory[0]!.find((m) => m.id === core.id)!;
    expect(seen.hp).toBe(core.hp);
    // it leaves; the core is hurt, then destroyed, out of sight: the memory does not change
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 20 * T, y: 30 * T });
    h.run(500, () => !canSee(h.ctx, 1, core));
    core.hp = 100;
    h.run(5);
    expect(h.world.memory[0]!.find((m) => m.id === core.id)!.hp).toBe(seen.hp);
    expect(scout.cb!.target).not.toBe(hidden.id);
    // a hidden enemy on a building site: the preview (what the player sees) says yes, the
    // simulation says no — with the same words it uses for a visible one
    const hq = h.world.entities.find((e) => e.type === 'bld_wl_lymphnode')!;
    h.cmd(1, { type: 'QUEUE_BUILD', units: [], building: hq.id, build: 'bld_wl_capillary' });
    h.run(1);
    const lurker = spawnUnit(h.world, catalog, 'unit_col_coccus', 2, 15 * T + 128, 34 * T + 128);
    h.run(1);
    const own = (e: Entity) => canSee(h.ctx, 1, e) || e.owner === 1;
    if (!canSee(h.ctx, 1, lurker)) {
      expect(checkPlacement(h.world, h.ctx, 1, 'bld_wl_capillary', 15, 34, own).ok).toBe(true);
    }
    expect(h.try(1, { type: 'PLACE_BUILD', units: [], building: hq.id, tx: 15, ty: 34 })).toBe('site_blocked');
  });

  it('the remembered building is forgotten once its empty site is seen again', () => {
    const h = arenaMatch();
    const scout = h.world.entities.find((e) => e.type === 'unit_wl_monocyte')!;
    const iron = h.world.entities.find((e) => e.type === 'res_iron')!;
    h.cmd(2, { type: 'DEV_SPAWN', units: [], unit: 'bld_col_siderophore', count: 1, x: iron.x, y: iron.y });
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 80 * T, y: 18 * T });
    h.run(600, () => scout.order.kind === 'idle');
    const tower = h.world.entities.find((e) => e.type === 'bld_col_siderophore')!;
    expect(h.world.memory[0]!.some((m) => m.id === tower.id)).toBe(true);
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 40 * T, y: 30 * T });
    h.run(600, () => scout.order.kind === 'idle');
    h.cmd(2, { type: 'DEV_KILL', units: [], targets: [tower.id] });
    h.run(2);
    expect(h.world.memory[0]!.some((m) => m.id === tower.id)).toBe(true); // still believed standing
    h.cmd(1, { type: 'MOVE', units: [scout.id], x: 80 * T, y: 18 * T });
    h.run(600, () => scout.order.kind === 'idle');
    expect(h.world.memory[0]!.some((m) => m.id === tower.id)).toBe(false);
  });
});

describe('gate 5 acceptance: a full fight against a passive opponent', () => {
  it('the White Line marches on the Colony, beats its defenders and destroys its core; nothing breaks', () => {
    const h = arenaMatch();
    const w = h.world;
    const spawn = (type: string, owner: number, n: number, x: number, y: number) => {
      h.cmd(owner, { type: 'DEV_SPAWN', units: [], unit: type, count: n, x: x * T, y: y * T });
    };
    spawn('unit_wl_neutrophil', 1, 20, 18, 30);
    spawn('unit_wl_macrophage', 1, 6, 20, 25);
    spawn('unit_wl_eosinophil', 1, 8, 16, 34);
    spawn('unit_col_coccus', 2, 12, 84, 26);
    spawn('unit_col_flagellate', 2, 4, 86, 22);
    spawn('unit_col_strep', 2, 2, 84, 32);
    spawn('unit_col_spirochete', 2, 2, 86, 34);
    h.run(2);
    const army = w.entities.filter((e) => e.owner === 1 && e.cb && !e.building).map((e) => e.id);
    const core = w.entities.find((e) => e.type === 'bld_col_biofilm_core')!;
    // through the wide gap in the north, then on to the core
    h.cmd(1, { type: 'ATTACK_MOVE', units: army, x: 40 * T, y: 6 * T });
    h.run(500);
    h.cmd(1, { type: 'ATTACK_MOVE', units: army.filter((id) => entityById(w, id)), x: core.x, y: core.y + 4 * T });
    let t = 0;
    h.run(4000, () => {
      t++;
      if (t % 600 === 0) h.cmd(1, { type: 'ATTACK_MOVE', units: army.filter((id) => entityById(w, id)), x: core.x, y: core.y + 4 * T });
      return w.outcome !== null;
    });
    expect(h.problems).toEqual([]);
    expect(w.outcome?.winnerTeam).toBe(1);
    const left = army.filter((id) => entityById(w, id)).length;
    const colonyArmy = w.entities.filter((e) => e.owner === 2 && e.cb && !e.building).length;
    const kills = h.events.filter((e) => e.type === 'died' && e.owner === 2).length;
    console.log(`fight over at tick ${w.tick} (${(w.tick / 20).toFixed(0)} s): ${left}/${army.length} of the army left, Colony fighters left ${colonyArmy}, Colony losses ${kills}`);
  });
});

describe('determinism with combat', () => {
  it('save in the middle of a fight, with attacks winding up and projectiles in flight: identical to never stopping', async () => {
    const { runHeadless } = await import('../../src/sim/headless');
    const { snapshot, restore } = await import('../../src/sim/core/world');
    const { contextForWorld } = await import('../../src/sim/context');
    const { CommandQueue } = await import('../../src/sim/commands/commands');
    const { arena, newCtx, setup } = await import('./helpers');
    const dev = { ...setup, dev: true };
    const script = (world: World, tick: number) => {
      if (tick === 0)
        return [
          { player: 1, seq: 1, tick, cmd: { type: 'DEV_SPAWN' as const, units: [], unit: 'unit_wl_eosinophil', count: 12, x: 44 * T, y: 26 * T } },
          { player: 1, seq: 2, tick, cmd: { type: 'DEV_SPAWN' as const, units: [], unit: 'unit_wl_neutrophil', count: 12, x: 44 * T, y: 30 * T } },
          { player: 2, seq: 1, tick, cmd: { type: 'DEV_SPAWN' as const, units: [], unit: 'unit_col_toxin', count: 6, x: 58 * T, y: 28 * T } },
          { player: 2, seq: 2, tick, cmd: { type: 'DEV_SPAWN' as const, units: [], unit: 'unit_col_coccus', count: 14, x: 58 * T, y: 24 * T } },
        ];
      if (tick === 2) {
        const mine = (o: number) => world.entities.filter((e) => e.owner === o && e.cb && !e.building).map((e) => e.id);
        return [
          { player: 1, seq: 3, tick, cmd: { type: 'ATTACK_MOVE' as const, units: mine(1), x: 60 * T, y: 28 * T } },
          { player: 2, seq: 3, tick, cmd: { type: 'ATTACK_MOVE' as const, units: mine(2), x: 42 * T, y: 28 * T } },
        ];
      }
      return [];
    };
    const full = runHeadless(newCtx(), dev, { ticks: 900, script, invariants: true });
    expect(full.problems).toEqual([]);
    expect(full.events.filter((e) => e.type === 'died').length).toBeGreaterThan(10);
    // find a tick with shots in the air
    let cut = 0;
    for (let t = 60; t < 600 && !cut; t += 5) {
      const probe = runHeadless(newCtx(), dev, { ticks: t, script });
      if (probe.world.projectiles.length > 0 && probe.world.entities.some((e) => e.cb && e.cb.windupEnd >= 0)) cut = t;
    }
    expect(cut).toBeGreaterThan(0);
    const half = runHeadless(newCtx(), dev, { ticks: cut, script });
    const world = restore(snapshot(half.world));
    const resumed = runHeadless(contextForWorld(catalog, arena, world), dev, { ticks: 900 - cut, script, start: world, queue: CommandQueue.fromJSON(half.queue.toJSON()) });
    expect(resumed.finalHash).toBe(full.finalHash);
  });
});
