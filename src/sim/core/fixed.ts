// Integer-only arithmetic for the simulation.
// Positions are in sub-tiles (1/256 of a tile), multipliers in thousandths, time in ticks.
// Every function here takes and returns safe integers; nothing rounds through floats
// that could differ between machines.

export const SUB = 256;
export const TICKS_PER_SECOND = 20;
export const TICK_MS = 50;
export const MILLI = 1000;

/** Integer division rounding toward zero. */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** v × (m / 1000), rounded toward zero. */
export function mulMilli(v: number, m: number): number {
  return Math.trunc((v * m) / MILLI);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Largest integer r with r*r <= n (n >= 0). Exact for n below 2^53. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return isqrt(dist2(ax, ay, bx, by));
}

export const tiles = (t: number): number => Math.round(t * SUB);
export const seconds = (s: number): number => Math.round(s * TICKS_PER_SECOND);
/** tiles per second → sub-tiles per tick */
export const tilesPerSecond = (t: number): number => Math.round((t * SUB) / TICKS_PER_SECOND);

export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}
