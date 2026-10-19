// FNV-1a over a canonical stream of integers and strings. Used for desync detection,
// replay checkpoints and the content hash.

export class Hasher {
  private h = 0x811c9dc5;

  int(v: number): this {
    // hash the value as two 32-bit halves so that values above 2^32 still count
    const lo = v >>> 0;
    const hi = Math.floor(v / 0x100000000) >>> 0;
    this.u32(lo);
    this.u32(hi);
    return this;
  }

  bool(v: boolean): this {
    return this.byte(v ? 1 : 0);
  }

  str(s: string): this {
    this.int(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.byte(c & 0xff);
      this.byte(c >>> 8);
    }
    return this;
  }

  private u32(v: number): void {
    this.byte(v & 0xff);
    this.byte((v >>> 8) & 0xff);
    this.byte((v >>> 16) & 0xff);
    this.byte((v >>> 24) & 0xff);
  }

  private byte(b: number): this {
    this.h ^= b;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
    return this;
  }

  value(): number {
    return this.h >>> 0;
  }

  hex(): string {
    return this.value().toString(16).padStart(8, '0');
  }
}

/** Hash any JSON-like value with sorted object keys (for content files). */
export function hashJson(v: unknown, h = new Hasher()): Hasher {
  if (v === null || v === undefined) h.int(0);
  else if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`hashJson: non-integer number ${v}`);
    h.int(v);
  } else if (typeof v === 'boolean') h.bool(v);
  else if (typeof v === 'string') h.str(v);
  else if (Array.isArray(v)) {
    h.int(v.length);
    for (const x of v) hashJson(x, h);
  } else if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    h.int(keys.length);
    for (const k of keys) {
      h.str(k);
      hashJson((v as Record<string, unknown>)[k], h);
    }
  }
  return h;
}
