import { describe, expect, it } from 'vitest';
import { idiv, isqrt, mulMilli } from '../../src/sim/core/fixed';
import { Hasher } from '../../src/sim/core/hash';
import { cloneRng, nextInt, nextU32, seedRng } from '../../src/sim/core/rng';

describe('integer maths', () => {
  it('isqrt is the exact floor square root', () => {
    const rng = seedRng(1);
    for (let i = 0; i < 5000; i++) {
      const n = nextU32(rng) * 2048 + nextInt(rng, 2048); // up to ~2^43
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
    expect([isqrt(0), isqrt(1), isqrt(15), isqrt(16), isqrt(17)]).toEqual([0, 1, 3, 4, 4]);
  });
  it('divisions round toward zero, also for negatives', () => {
    expect([idiv(7, 2), idiv(-7, 2), mulMilli(100, 1500), mulMilli(-3, 1500)]).toEqual([3, -3, 150, -4]);
  });
});

describe('gameplay RNG', () => {
  it('the same seed gives the same stream, and a copy continues identically', () => {
    const a = seedRng(42);
    const b = seedRng(42);
    const sa = Array.from({ length: 50 }, () => nextU32(a));
    const sb = Array.from({ length: 50 }, () => nextU32(b));
    expect(sb).toEqual(sa);
    const c = cloneRng(a);
    expect(nextU32(c)).toBe(nextU32(a));
  });
  it('nextInt stays in range and is roughly uniform', () => {
    const r = seedRng(3);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[nextInt(r, 6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
    expect(() => nextInt(r, 0)).toThrow();
  });
  it('every value is an unsigned 32-bit integer', () => {
    const r = seedRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = nextU32(r);
      expect(Number.isInteger(v) && v >= 0 && v < 2 ** 32).toBe(true);
    }
  });
});

describe('hash', () => {
  it('is stable and sensitive to every field', () => {
    const h = (f: (x: Hasher) => void) => { const x = new Hasher(); f(x); return x.hex(); };
    expect(h((x) => x.int(1).str('a'))).toBe(h((x) => x.int(1).str('a')));
    expect(h((x) => x.int(1).str('a'))).not.toBe(h((x) => x.int(2).str('a')));
    expect(h((x) => x.int(2 ** 33))).not.toBe(h((x) => x.int(0)));
  });
});
