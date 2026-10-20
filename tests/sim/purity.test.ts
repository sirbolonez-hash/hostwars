// The simulation must not reach for anything that differs between machines or runs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/Math\.random/, 'Math.random (use the gameplay RNG)'],
  [/Date\.now|new Date\(|performance\.now/, 'wall-clock time'],
  [/setTimeout|setInterval|requestAnimationFrame/, 'timers'],
  [/from ['"]pixi\.js['"]/, 'rendering imports'],
  [/\b(window|document|localStorage)\./, 'browser globals'],
  [/Math\.(sin|cos|tan|atan2|pow|exp|log)\(/, 'transcendental float maths'],
];

describe('simulation purity', () => {
  const sources = files('src/sim');
  it('has source files to check', () => expect(sources.length).toBeGreaterThan(5));
  for (const f of sources) {
    it(f, () => {
      const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      const hits = FORBIDDEN.filter(([re]) => re.test(text)).map(([, why]) => why);
      expect(hits).toEqual([]);
    });
  }
});

describe('AI purity', () => {
  const sources = [...files('src/ai'), ...files('src/match')];
  it('has source files to check', () => expect(sources.length).toBeGreaterThan(2));
  for (const f of sources) {
    it(f, () => {
      const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      const hits = FORBIDDEN.filter(([re]) => re.test(text)).map(([, why]) => why);
      expect(hits).toEqual([]);
    });
  }
  // the AI sees an observation and sends commands; it never touches the world
  for (const f of files('src/ai')) {
    it(`${f} imports only types from the simulation`, () => {
      const text = readFileSync(f, 'utf8');
      const bad = [...text.matchAll(/^import\s+(?!type\b)[^;]*from\s+['"](\.\.\/sim[^'"]*)['"]/gm)].map((m) => m[1]);
      expect(bad).toEqual([]);
    });
  }
});
