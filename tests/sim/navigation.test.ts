import { describe, expect, it } from 'vitest';
import { spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import type { SimContext } from '../../src/sim/context';
import { AStar } from '../../src/sim/navigation/astar';
import { NavGrid } from '../../src/sim/navigation/grid';
import { lineClear, smoothPath } from '../../src/sim/navigation/los';
import { PATH_BUDGET } from '../../src/sim/navigation/movement';
import { checkInvariants, step, type SimEvent } from '../../src/sim/sim';
import { asciiMap, catalog, matchOn, newCtx, setup } from './helpers';
import { createWorld } from '../../src/sim/core/world';

const T = 256;

function open(w: number, h: number, edit?: (g: string[][]) => void): string[] {
  const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  edit?.(g);
  return g.map((r) => r.join(''));
}

/** Runs ticks, ordering `units` to (x, y) at tick 0, until all arrive or `max` ticks pass. */
function travel(ctx: SimContext, world: World, units: Entity[], x: number, y: number, max: number) {
  const events: SimEvent[] = [];
  const problems: string[] = [];
  let maxExp = 0;
  let seq = (world.tick + 1) * 1000;
  const owner = units[0]!.owner;
  const cmd = { player: owner, seq: seq++, tick: world.tick, cmd: { type: 'MOVE' as const, units: units.map((u) => u.id), x, y } };
  const ids = new Set(units.map((u) => u.id));
  const done = new Set<number>();
  let ticks = 0;
  for (; ticks < max && done.size < ids.size; ticks++) {
    const res = step(world, ctx, ticks === 0 ? [cmd] : []);
    maxExp = Math.max(maxExp, res.stats.pathExpansions);
    for (const e of res.events) {
      events.push(e);
      if ((e.type === 'arrived' || e.type === 'blocked') && ids.has(e.entity)) done.add(e.entity);
    }
    for (const p of checkInvariants(world, ctx)) problems.push(`tick ${world.tick}: ${p}`);
  }
  return { events, problems, ticks, maxExp, arrived: events.filter((e) => e.type === 'arrived' && ids.has(e.entity)).length, blocked: events.filter((e) => e.type === 'blocked' && ids.has(e.entity)).length };
}

describe('A* and lines', () => {
  const map = asciiMap('astar', open(20, 12, (g) => { for (let y = 1; y < 10; y++) g[y]![10] = '#'; }));
  const nav = new NavGrid(map);
  const astar = new AStar(nav);

  it('goes around a wall and never cuts a corner', () => {
    const r = astar.search(2, 5, 17, 5, 1, 10000);
    expect(r.reachedGoal).toBe(true);
    for (let k = 0; k < r.nodes.length; k += 2) expect(nav.passable(r.nodes[k]!, r.nodes[k + 1]!, 1)).toBe(true);
    for (let k = 2; k < r.nodes.length; k += 2) {
      const [px, py, x, y] = [r.nodes[k - 2]!, r.nodes[k - 1]!, r.nodes[k]!, r.nodes[k + 1]!];
      expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1);
      if (x !== px && y !== py) {
        expect(nav.passable(x, py, 1)).toBe(true);
        expect(nav.passable(px, y, 1)).toBe(true);
      }
    }
    // the wall ends at y = 9, so the path must pass through row 10
    expect(r.nodes.some((v, k) => k % 2 === 1 && v === 10)).toBe(true);
  });

  it('an unreachable goal yields the closest reachable tile', () => {
    const box = asciiMap('box', open(20, 12, (g) => { for (let y = 3; y <= 7; y++) for (let x = 12; x <= 16; x++) g[y]![x] = y === 3 || y === 7 || x === 12 || x === 16 ? '#' : '.'; }));
    const bnav = new NavGrid(box);
    const r = new AStar(bnav).search(2, 5, 14, 5, 1, 10000);
    expect(r.reachedGoal).toBe(false);
    const end = [r.nodes[r.nodes.length - 2], r.nodes[r.nodes.length - 1]];
    expect(end).toEqual([11, 5]);
  });

  it('a large body passes a 2-tile gap but not a 1-tile gap', () => {
    const gaps = asciiMap('gaps', open(20, 14, (g) => {
      for (let y = 1; y < 13; y++) g[y]![10] = '#';
      g[3]![10] = '.'; // 1 wide
    }));
    const n1 = new NavGrid(gaps);
    expect(new AStar(n1).search(2, 3, 16, 3, 2, 10000).reachedGoal).toBe(false);
    expect(new AStar(n1).search(2, 3, 16, 3, 1, 10000).reachedGoal).toBe(true);
    const gaps2 = asciiMap('gaps2', open(20, 14, (g) => {
      for (let y = 1; y < 13; y++) g[y]![10] = '#';
      g[3]![10] = '.';
      g[4]![10] = '.'; // 2 wide
    }));
    expect(new AStar(new NavGrid(gaps2)).search(2, 3, 16, 3, 2, 10000).reachedGoal).toBe(true);
  });

  it('lines see through open ground and not through a corner', () => {
    expect(lineClear(nav, 2, 2, 8, 9, 1)).toBe(true);
    expect(lineClear(nav, 2, 5, 17, 5, 1)).toBe(false);
    const corner = new NavGrid(asciiMap('corner', ['#####', '#.#.#', '##..#', '#...#', '#####']));
    expect(lineClear(corner, 1, 1, 2, 2, 1)).toBe(false); // diagonal between two walls
  });

  it('a body-wide line refuses to graze a corner the centre line would pass', () => {
    // a wall tile at (5, 5); the centre line from node (3, 2) to node (5, 8) passes a third of a tile from it
    const g = new NavGrid(asciiMap('graze', open(12, 12, (rows) => { rows[5]![5] = '#'; })));
    expect(lineClear(g, 3, 2, 5, 8, 1)).toBe(true);
    expect(smoothPath(g, [3, 2, 3, 3, 4, 4, 4, 5, 4, 6, 4, 7, 5, 8], 1, 115).length).toBeGreaterThan(2);
  });

  it('smoothing turns an open-ground path into one straight leg', () => {
    const r = astar.search(2, 2, 8, 9, 1, 10000);
    expect(smoothPath(nav, r.nodes, 1, 115)).toEqual([8, 9]);
  });
});

describe('movement (gate 2 acceptance)', () => {
  it('80 units pass a 2-tile choke without getting stuck or entering walls', () => {
    const rows = open(64, 34, (g) => {
      for (let y = 1; y < 33; y++) g[y]![30] = '#';
      g[16]![30] = '.';
      g[17]![30] = '.';
    });
    const { ctx, world } = matchOn(asciiMap('choke', rows));
    const units: Entity[] = [];
    for (let k = 0; k < 80; k++) units.push(spawnUnit(world, catalog, 'unit_wl_neutrophil', 1, (6 + (k % 10) * 2) * T + 128, (10 + Math.floor(k / 10) * 2) * T + 128));
    const r = travel(ctx, world, units, 48 * T, 17 * T, 2400);
    expect(r.problems).toEqual([]);
    expect(r.blocked).toBe(0);
    expect(r.arrived).toBe(80);
    expect(units.every((u) => u.x > 31 * T)).toBe(true);
    // budget: one search may run past the budget, never more
    expect(r.maxExp).toBeLessThanOrEqual(PATH_BUDGET + 64 * 34);
    console.log(`choke: 80 units through in ${r.ticks} ticks (${(r.ticks / 20).toFixed(1)} s), max ${r.maxExp} expansions in a tick`);
  });

  it('a unit inside the U-shaped cup gets out to a point behind it', () => {
    const ctx = newCtx();
    const world = createWorld(ctx, setup);
    const u = spawnUnit(world, catalog, 'unit_wl_monocyte', 1, 70 * T + 128, 27 * T + 128);
    const r = travel(ctx, world, [u], 58 * T + 128, 27 * T + 128, 1600);
    expect(r.problems).toEqual([]);
    expect(r.arrived).toBe(1);
    expect(Math.abs(u.x - (58 * T + 128))).toBeLessThan(T);
  });

  it('a group spreads over separate arrival spots', () => {
    const ctx = newCtx();
    const world = createWorld(ctx, setup);
    const units = Array.from({ length: 20 }, (_, k) => spawnUnit(world, catalog, 'unit_wl_neutrophil', 1, (5 + (k % 5)) * T + 128, (18 + Math.floor(k / 5)) * T + 128));
    const r = travel(ctx, world, units, 20 * T, 34 * T, 1200);
    expect(r.arrived).toBe(20);
    for (let i = 0; i < units.length; i++)
      for (let j = i + 1; j < units.length; j++) {
        const d = Math.hypot(units[i]!.x - units[j]!.x, units[i]!.y - units[j]!.y);
        expect(d).toBeGreaterThan(T * 0.5);
      }
  });

  it('a large body uses the 2-tile gap and a small one may take the 1-tile gap', () => {
    const rows = open(40, 24, (g) => {
      for (let y = 1; y < 23; y++) g[y]![20] = '#';
      g[4]![20] = '.'; // 1 wide, near
      g[18]![20] = '.';
      g[19]![20] = '.'; // 2 wide, far
    });
    const { ctx, world } = matchOn(asciiMap('twogaps', rows));
    const big = spawnUnit(world, catalog, 'unit_wl_macrophage', 1, 12 * T, 4 * T);
    const r = travel(ctx, world, [big], 30 * T, 4 * T, 1600);
    expect(r.problems).toEqual([]);
    expect(r.arrived).toBe(1);
    const small = spawnUnit(world, catalog, 'unit_wl_monocyte', 1, 12 * T + 128, 4 * T + 128);
    const r2 = travel(ctx, world, [small], 30 * T + 128, 4 * T + 128, 600);
    expect(r2.arrived).toBe(1);
    expect(r2.ticks).toBeLessThan(r.ticks); // the short way was open to it
  });

  it('the current speeds travel downstream and slows it upstream', () => {
    const rows = open(16, 60, (g) => { for (let y = 1; y < 59; y++) for (let x = 3; x <= 6; x++) g[y]![x] = '~'; });
    const time = (flow: boolean, down: boolean) => {
      const { ctx, world } = matchOn({ ...asciiMap('river', rows, flow ? [{ rect: [3, 1, 4, 58], dir: [0, 1], strength: 1000 }] : []), starts: [[9, 2], [9, 52]] }, 3);
      const u = spawnUnit(world, catalog, 'unit_wl_monocyte', 1, 5 * T, (down ? 10 : 50) * T);
      return travel(ctx, world, [u], 5 * T, (down ? 50 : 10) * T, 2000).ticks;
    };
    const still = time(false, true);
    const down = time(true, true);
    const up = time(true, false);
    expect(down).toBeLessThan(still * 0.6);
    expect(up).toBeGreaterThan(still * 1.7);
    console.log(`current: 40 tiles still ${still} ticks, downstream ${down}, upstream ${up}`);
  });

  it('sent into a sealed room, a unit stops at the closest reachable point instead of hanging', () => {
    const rows = open(30, 16, (g) => {
      for (let y = 4; y <= 10; y++) for (let x = 18; x <= 25; x++) g[y]![x] = y === 4 || y === 10 || x === 18 || x === 25 ? '#' : '.';
    });
    const { ctx, world } = matchOn({ ...asciiMap('room', rows), starts: [[2, 2], [2, 8]] });
    const u = spawnUnit(world, catalog, 'unit_wl_monocyte', 1, 10 * T, 7 * T);
    const r = travel(ctx, world, [u], 21 * T, 7 * T, 800);
    expect(r.arrived).toBe(1);
    expect(u.x).toBeLessThan(18 * T);
    expect(u.order.kind).toBe('idle');
  });

  it('nobody walks through a building', () => {
    const ctx = newCtx();
    const world = createWorld(ctx, setup);
    const hq = world.entities.find((e) => e.building && e.owner === 1)!;
    expect(ctx.nav.blocked(Math.floor(hq.x / T), Math.floor(hq.y / T))).toBe(true);
    const units = world.entities.filter((e) => e.owner === 1 && !e.building);
    const r = travel(ctx, world, units, 9 * T, 18 * T, 1200); // just above the HQ: around it, not through
    expect(r.problems).toEqual([]);
    expect(r.arrived + r.blocked).toBe(units.length);
    expect(r.blocked).toBe(0);
  });
});
