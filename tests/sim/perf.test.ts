// Timing of the reference crowd: 100 units per side crossing the arena toward each other.
// The bound here is loose (CI machines vary); the printed numbers are the real record.
import { describe, expect, it } from 'vitest';
import { createWorld, spawnUnit } from '../../src/sim/core/world';
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
    for (let k = 0; k < 100; k++) {
      a.push(spawnUnit(world, catalog, wl[k % 4]!, 1, (4 + (k % 10) * 1.6) * T, (17 + Math.floor(k / 10) * 2.2) * T).id);
      b.push(spawnUnit(world, catalog, col[k % 4]!, 2, (84 + (k % 10) * 1.6) * T, (17 + Math.floor(k / 10) * 2.2) * T).id);
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
});
