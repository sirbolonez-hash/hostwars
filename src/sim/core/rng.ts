// Gameplay RNG: sfc32 with 32-bit integer operations only. The state is four uint32s,
// saved in snapshots and replays. Cosmetic randomness must use a separate generator.

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function seedRng(seed: number): RngState {
  const sm = splitmix32(seed);
  const st: RngState = { a: sm(), b: sm(), c: sm(), d: sm() };
  for (let i = 0; i < 12; i++) nextU32(st); // warm up
  return st;
}

/** Next uint32; advances the state in place. */
export function nextU32(st: RngState): number {
  const t = (((st.a + st.b) >>> 0) + st.d) >>> 0;
  st.d = (st.d + 1) >>> 0;
  st.a = (st.b ^ (st.b >>> 9)) >>> 0;
  st.b = (st.c + (st.c << 3)) >>> 0;
  st.c = ((st.c << 21) | (st.c >>> 11)) >>> 0;
  st.c = (st.c + t) >>> 0;
  return t;
}

/** Uniform integer in [0, n) without modulo bias. n must be a positive integer below 2^32. */
export function nextInt(st: RngState, n: number): number {
  if (!(n > 0 && n <= 0x100000000 && Number.isInteger(n))) throw new RangeError(`nextInt: bad bound ${n}`);
  const limit = 0x100000000 - (0x100000000 % n);
  let v = nextU32(st);
  while (v >= limit) v = nextU32(st);
  return v % n;
}

export function cloneRng(st: RngState): RngState {
  return { a: st.a, b: st.b, c: st.c, d: st.d };
}
