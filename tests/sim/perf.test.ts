// Timing of the reference crowd: 100 units per side crossing the arena toward each other.
// The bound here is loose (CI machines vary); the printed numbers are the real record.
import { describe, expect, it } from 'vitest';
import { createWorld, spawnUnit } from '../../src/sim/core/world';
import { CLASS_SIZE, centreOf } from '../../src/sim/navigation/grid';
import { nearestPassable } from '../../src/sim/navigation/slots';
import { step } from '../../src/sim/sim';
import { catalog, newCtx, setup } from './helpers';

const T = 256;

describe('performance', () => {
  it('200 units crossing the arena: tick time', () => {
    const ctx = newCtx();
    const world = createWorld(ctx, setup);
    const wl = ['unit_wl_neutrophil', 'unit_wl_monocyte', 'unit_wl_eosinophil', 'unit_wl_macrophage'];
    const col = ['unit_col_coccus', 'unit_col_flagellate', 'unit_col_spirochete', 'unit_col_strep'];
    const a: number[] = [];
    const b: number[] = [];
    // on the nearest open spot: the bases have buildings and crystals now
    const put = (type: string, owner: number, x: number, y: number) => {
      const size = CLASS_SIZE[catalog.units.get(type)!.navClass];
      const n = nearestPassable(ctx.nav, Math.floor(x / T), Math.floor(y / T), size)!;
      const [cx, cy] = centreOf(n[0], n[1], size);
      return spawnUnit(world, catalog, type, owner, cx, cy).id;
    };
    for (let k = 0; k < 100; k++) {
      a.push(put(wl[k % 4]!, 1, (4 + (k % 10) * 1.6) * T, (17 + Math.floor(k / 10) * 2.2) * T));
      b.push(put(col[k % 4]!, 2, (84 + (k % 10) * 1.6) * T, (17 + Math.floor(k / 10) * 2.2) * T));
    }
    const times: number[] = [];
    let expansions = 0;
    for (let t = 0; t < 900; t++) {
      const cmds =
        t === 0
          ? [
              { player: 1, seq: 1, tick: 0, cmd: { type: 'MOVE' as const, units: a, x: 92 * T, y: 30 * T } },
              { player: 2, seq: 1, tick: 0, cmd: { type: 'MOVE' as const, units: b, x: 12 * T, y: 30 * T } },
            ]
          : [];
      const t0 = performance.now();
      const res = step(world, ctx, cmds);
      times.push(performance.now() - t0);
      expansions += res.stats.pathExpansions;
    }
    const sorted = [...times].sort((x, y) => x - y);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    console.log(`200 units, 900 ticks: avg ${avg.toFixed(2)} ms, p95 ${p(0.95).toFixed(2)} ms, p99 ${p(0.99).toFixed(2)} ms, max ${sorted.at(-1)!.toFixed(2)} ms, ${expansions} path expansions`);
    expect(p(0.95)).toBeLessThan(25);
  });

  it('60 carriers mining on both sides while 100 units cross: tick time', () => {
    const ctx = newCtx();
    const world = createWorld(ctx, setup);
    const put = (type: string, owner: number, x: number, y: number) => {
      const size = CLASS_SIZE[catalog.units.get(type)!.navClass];
      const n = nearestPassable(ctx.nav, Math.floor(x / T), Math.floor(y / T), size)!;
      const [cx, cy] = centreOf(n[0], n[1], size);
      return spawnUnit(world, catalog, type, owner, cx, cy).id;
    };
    for (let k = 0; k < 22; k++) {
      put('unit_wl_glut', 1, (13 + (k % 6)) * T, (30 + Math.floor(k / 6)) * T);
      put('unit_col_feeder', 2, (84 + (k % 6)) * T, (30 + Math.floor(k / 6)) * T);
    }
    const army: number[] = [];
    for (let k = 0; k < 100; k++) army.push(put('unit_wl_neutrophil', 1, (15 + (k % 10)) * T, (8 + Math.floor(k / 10)) * T));
    const carriers = (o: number) => world.entities.filter((e) => e.owner === o && (catalog.units.get(e.type)?.carry ?? 0) > 0).map((e) => e.id);
    const field = (f: number) => world.entities.find((e) => e.res?.field === f)!.id;
    const times: number[] = [];
    let delivered = 0;
    for (let t = 0; t < 1200; t++) {
      const cmds =
        t === 0
          ? [
              { player: 1, seq: 1, tick: 0, cmd: { type: 'GATHER' as const, units: carriers(1).slice(0, 18), target: field(1) } },
              { player: 1, seq: 2, tick: 0, cmd: { type: 'GATHER' as const, units: carriers(1).slice(18), target: field(3) } },
              { player: 1, seq: 3, tick: 0, cmd: { type: 'MOVE' as const, units: army, x: 92 * T, y: 50 * T } },
              { player: 2, seq: 1, tick: 0, cmd: { type: 'GATHER' as const, units: carriers(2), target: field(2) } },
            ]
          : [];
      const t0 = performance.now();
      const res = step(world, ctx, cmds);
      times.push(performance.now() - t0);
      for (const e of res.events) if (e.type === 'delivered') delivered++;
    }
    const sorted = [...times].sort((x, y) => x - y);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
    const avg = times.reduce((s, v) => s + v, 0) / times.length;
    console.log(`60 carriers + 100 movers, 1200 ticks: avg ${avg.toFixed(2)} ms, p95 ${p(0.95).toFixed(2)} ms, p99 ${p(0.99).toFixed(2)} ms, ${delivered} loads delivered`);
    expect(delivered).toBeGreaterThan(120);
    expect(p(0.95)).toBeLessThan(25);
  });
});
