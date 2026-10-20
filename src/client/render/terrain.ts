// Draws the static map once into a canvas: tissue ground, blood channels, membrane walls
// with shadow and outline. The result becomes one texture, so the GPU draws the whole
// ground in a single quad.

import type { MapDef } from '../../sim/content/types';
import { T_BLOOD, T_WALL, type NavGrid } from '../../sim/navigation/grid';

export const TILE_PX = 32;

export interface TerrainImages {
  ground: HTMLImageElement | ImageBitmap;
  blood: HTMLImageElement | ImageBitmap;
  wall: HTMLImageElement | ImageBitmap;
}

function pattern(ctx: CanvasRenderingContext2D, img: CanvasImageSource, scale: number): CanvasPattern {
  const p = ctx.createPattern(img, 'repeat')!;
  p.setTransform(new DOMMatrix().scaleSelf(scale, scale));
  return p;
}

function tilePath(nav: NavGrid, kind: number): Path2D {
  const path = new Path2D();
  for (let y = 0; y < nav.h; y++) {
    let x = 0;
    while (x < nav.w) {
      if (nav.terrain[y * nav.w + x] !== kind) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < nav.w && nav.terrain[y * nav.w + x] === kind) x++;
      path.rect(x0 * TILE_PX, y * TILE_PX, (x - x0) * TILE_PX, TILE_PX);
    }
  }
  return path;
}

/** Edges between tiles of `kind` and tiles that are not, as one stroke path. */
function edgePath(nav: NavGrid, kind: number): Path2D {
  const p = new Path2D();
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < nav.w && y < nav.h && nav.terrain[y * nav.w + x] === kind;
  for (let y = 0; y < nav.h; y++) {
    for (let x = 0; x < nav.w; x++) {
      if (!is(x, y)) continue;
      const X = x * TILE_PX;
      const Y = y * TILE_PX;
      if (!is(x, y - 1) && y > 0) { p.moveTo(X, Y); p.lineTo(X + TILE_PX, Y); }
      if (!is(x, y + 1) && y < nav.h - 1) { p.moveTo(X, Y + TILE_PX); p.lineTo(X + TILE_PX, Y + TILE_PX); }
      if (!is(x - 1, y) && x > 0) { p.moveTo(X, Y); p.lineTo(X, Y + TILE_PX); }
      if (!is(x + 1, y) && x < nav.w - 1) { p.moveTo(X + TILE_PX, Y); p.lineTo(X + TILE_PX, Y + TILE_PX); }
    }
  }
  return p;
}

export function drawTerrain(map: MapDef, nav: NavGrid, img: TerrainImages): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.w * TILE_PX;
  canvas.height = map.h * TILE_PX;
  const c = canvas.getContext('2d')!;

  // ground: the 512 px tile art is drawn at half size, so one repeat covers 8 tiles
  c.fillStyle = pattern(c, img.ground, 0.5);
  c.fillRect(0, 0, canvas.width, canvas.height);

  // blood channels, with darker banks
  const blood = tilePath(nav, T_BLOOD);
  c.save();
  c.clip(blood);
  c.fillStyle = pattern(c, img.blood, 0.5);
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
  c.save();
  c.strokeStyle = 'rgba(110, 10, 30, 0.45)';
  c.lineWidth = 4;
  c.lineCap = 'round';
  c.stroke(edgePath(nav, T_BLOOD));
  c.restore();

  // walls: soft shadow, membrane fill, plum outline, light rim
  const walls = tilePath(nav, T_WALL);
  c.save();
  c.translate(5, 7);
  c.filter = 'blur(5px)';
  c.fillStyle = 'rgba(42, 21, 48, 0.45)';
  c.fill(walls);
  c.restore();
  c.save();
  c.clip(walls);
  c.fillStyle = pattern(c, img.wall, 0.5);
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = 'rgba(255, 180, 162, 0.18)';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.restore();
  const edges = edgePath(nav, T_WALL);
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = '#2a1530';
  c.lineWidth = 5;
  c.stroke(edges);
  c.strokeStyle = 'rgba(255, 248, 238, 0.55)';
  c.lineWidth = 1.5;
  c.translate(-1, -1);
  c.stroke(edges);
  c.restore();
  return canvas;
}
