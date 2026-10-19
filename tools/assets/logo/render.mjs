// Rasterizes logo.svg to PNG at two widths. Run: node tools/assets/logo/render.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'logo.svg'), 'utf8');
for (const w of [1600, 800]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: w }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(join(here, `logo_${w}.png`), png);
  console.log(`logo_${w}.png`, png.length, 'bytes');
}
