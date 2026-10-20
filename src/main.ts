// Gate 2: the first playable build. A test arena, White Line against an idle Colony;
// select, move, and watch navigation work. No economy or combat yet.

import { Application, Assets, Container, Graphics, Texture } from 'pixi.js';
import { loadCatalog, loadMap } from './sim/content/load';
import { createContext } from './sim/context';
import { Game } from './client/game';
import { Camera, Controls } from './client/input/controls';
import { loadAtlasGroups, loadManifest } from './client/render/assets';
import { makeShapes } from './client/render/shapes';
import { drawTerrain, TILE_PX } from './client/render/terrain';
import { WorldView } from './client/render/worldView';
import { Hud } from './client/ui/hud';

const status = document.getElementById('load-status')!;

function gpuName(): string {
  const canvas = document.createElement('canvas');
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
  if (!gl) return 'WebGL לא זמין';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return `${name}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('לא נטען: ' + src));
    img.src = src;
  });
}

async function main(): Promise<void> {
  const gpu = gpuName();
  status.textContent = 'טוען גרפיקה…';
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: '#1c0f1a',
    preference: 'webgl',
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 1.5),
  });
  document.getElementById('stage')!.appendChild(app.canvas);

  const manifest = await loadManifest();
  const [textures, ground, blood, wall] = await Promise.all([
    loadAtlasGroups(manifest, ['units_wl', 'units_col', 'buildings_wl', 'buildings_col', 'world_neutral']),
    loadImage('assets/' + manifest.assets['tile_tissue']!.file),
    loadImage('assets/' + manifest.assets['tile_blood']!.file),
    loadImage('assets/' + manifest.assets['tile_bone']!.file),
  ]);

  status.textContent = 'בונה את הזירה…';
  const catalog = loadCatalog();
  const map = loadMap('arena');
  const ctx = createContext(catalog, map);
  const game = new Game(ctx, {
    seed: (Date.now() >>> 0) % 1_000_000,
    map: map.id,
    dev: true,
    players: [
      { faction: 'wl', team: 1, startTile: map.starts[0]! },
      { faction: 'col', team: 2, startTile: map.starts[1]! },
    ],
  });
  const terrain = Texture.from(drawTerrain(map, ctx.nav, { ground, blood, wall }));
  const shapes = makeShapes(app.renderer);
  const view = new WorldView(ctx, manifest, textures, shapes, terrain);
  app.stage.addChild(view.root);
  const screen = new Container();
  const box = new Graphics();
  screen.addChild(box);
  app.stage.addChild(screen);

  const cam = new Camera(map.w * TILE_PX, map.h * TILE_PX);
  const [sx, sy] = map.starts[0]!;
  cam.centreOn((sx + 4) * TILE_PX, (sy + 2) * TILE_PX, app.screen.width, app.screen.height);
  const controls = new Controls(app.canvas, game, view, cam, box);
  const hud = new Hud(game, controls, view, gpu, () => [(sx + 8) * 256, (sy - 3) * 256]);

  // nothing runs until the player presses start
  game.paused = true;
  const overlay = document.getElementById('start')!;
  status.textContent = '';
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  startBtn.disabled = false;
  startBtn.focus();
  startBtn.addEventListener('click', () => {
    overlay.hidden = true;
    game.paused = false;
  });

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS;
    controls.update(dt);
    const alpha = game.frame(dt);
    view.sync(game.world, game.prev, alpha, controls.selected, performance.now(), dt);
    cam.apply(view.root);
    hud.update(dt);
  });

  // expose for quick checks from the browser console
  (window as unknown as { hostwars: unknown }).hostwars = { game, view, controls, assets: Assets };
}

main().catch((e: unknown) => {
  status.textContent = 'שגיאה בטעינה: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
});
