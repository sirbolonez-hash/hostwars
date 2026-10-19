import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('asset contract', () => {
  it('every manifest reference resolves', () => {
    const out = execFileSync('node', ['tools/check-assets.mjs'], { encoding: 'utf8' });
    expect(out).toContain('asset contract OK');
  });
});
