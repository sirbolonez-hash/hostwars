// Asset contract check: every reference in public/assets/manifest.json must resolve.
// Run: node tools/check-assets.mjs   (exit code 1 on any error)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const errors = [];
const err = (m) => errors.push(m);
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
if (manifest.version !== 1) err(`manifest version ${manifest.version} is not 1`);

const frameIndex = new Map(); // frame name -> page key
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
let vram = 0;
for (const [group, pages] of Object.entries(manifest.atlases)) {
  pages.forEach((p, i) => {
    const key = `${group}_${i}`;
    if (!existsSync(join(ROOT, p.image))) err(`${key}: missing image ${p.image}`);
    if (!existsSync(join(ROOT, p.json))) { err(`${key}: missing json ${p.json}`); return; }
    const sheet = JSON.parse(readFileSync(join(ROOT, p.json), 'utf8'));
    const names = Object.keys(sheet.frames);
    if (names.length !== p.sprites) err(`${key}: manifest says ${p.sprites} sprites, json has ${names.length}`);
    if (p.w > 2048 || p.h > 2048) err(`${key}: ${p.w}x${p.h} exceeds 2048`);
    if (!isPow2(p.w) || !isPow2(p.h)) err(`${key}: ${p.w}x${p.h} is not power-of-two`);
    vram += p.w * p.h * 4;
    for (const n of names) {
      if (frameIndex.has(n)) err(`frame ${n} appears in ${frameIndex.get(n)} and ${key}`);
      frameIndex.set(n, key);
      const f = sheet.frames[n].frame;
      if (f.x < 0 || f.y < 0 || f.x + f.w > p.w || f.y + f.h > p.h) err(`${key}: frame ${n} outside the page`);
    }
  });
}

const fileFields = ['file', 'preview'];
let counts = {};
for (const [id, a] of Object.entries(manifest.assets)) {
  counts[a.kind] = (counts[a.kind] || 0) + 1;
  for (const f of fileFields) if (a[f] && !existsSync(join(ROOT, a[f]))) err(`${id}: missing ${f} ${a[f]}`);
  for (const f of a.files || []) if (!existsSync(join(ROOT, f))) err(`${id}: missing file ${f}`);
  if (['unit', 'hero', 'building', 'hostcell', 'resource', 'icon'].includes(a.kind)) {
    if (!frameIndex.has(id)) err(`${id}: no atlas frame`);
    if (!(a.w > 0 && a.h > 0)) err(`${id}: bad size ${a.w}x${a.h}`);
    if (!a.anchor || a.anchor.some((v) => v < 0 || v > 1)) err(`${id}: anchor outside 0..1`);
  }
  if ((a.kind === 'unit' || a.kind === 'hero') && !(a.radius > 0)) err(`${id}: radius must be > 0`);
  if (['building', 'hostcell', 'resource'].includes(a.kind)) {
    const fp = a.footprint;
    if (!fp || fp.length !== 2 || fp.some((v) => !Number.isInteger(v) || v < 1 || v > 6)) err(`${id}: footprint ${JSON.stringify(fp)}`);
  }
  if (a.kind === 'fx') {
    if (!['add', 'key'].includes(a.blend)) err(`${id}: blend ${a.blend}`);
    if (!(a.fps > 0)) err(`${id}: fps ${a.fps}`);
    if (!a.frames || a.frames.length < 6) err(`${id}: only ${a.frames?.length ?? 0} frames`);
    for (const fr of a.frames || []) if (!frameIndex.has(fr)) err(`${id}: frame ${fr} not in any atlas`);
  }
  if (a.kind === 'map' && !(a.tiles?.[0] > 0 && a.tiles?.[1] > 0)) err(`${id}: map tiles ${JSON.stringify(a.tiles)}`);
}

console.log(`assets: ${Object.keys(manifest.assets).length}  ` + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
console.log(`atlas frames: ${frameIndex.size}  atlas VRAM if all loaded: ${(vram / 2 ** 20).toFixed(0)} MiB`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('asset contract OK');
