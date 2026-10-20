// Gate 3: the test arena with an economy. White Line against a Colony that only mines;
// select, move, gather, and watch the loads come in. No construction or combat yet.

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
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
    // only the first page of two effect sets: the harvest sparkle and the ATP burst live there
    loadAtlasGroups(manifest, ['units_wl', 'units_col', 'buildings_wl', 'buildings_col', 'world_neutral', 'icons', 'fx_a:0', 'fx_b:0']),
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
  cam.centreOn((sx + 2) * TILE_PX, (sy + 2) * TILE_PX, app.screen.width, app.screen.height);
  const controls = new Controls(app.canvas, game, view, cam, box);
  // icons for the DOM, cut out of the atlas once
  const iconUrl = async (id: string) => {
    const t = textures.get(id);
    return t ? await app.renderer.extract.base64(new Sprite(t)) : '';
  };
  const icons = { atp: await iconUrl('icon_atp'), amino: await iconUrl('icon_amino') };
  const hud = new Hud(game, controls, view, gpu, { spawn: [(sx + 8) * 256, (sy + 6) * 256], depot: [16 * 256 + 128, 10 * 256 + 128] }, icons);

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
    // both sides start mining at once: the White Line by the player's hand, the Colony
    // by the test lab (it has no AI before gate 6)
    for (const player of [1, 2]) {
      const carriers = game.world.entities.filter((e) => e.owner === player && (catalog.units.get(e.type)?.carry ?? 0) > 0);
      const hq = game.world.entities.find((e) => e.owner === player && e.building);
      const crystal = game.world.entities
        .filter((e) => e.res && e.res.field > 0)
        .sort((a, b) => (hq ? Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y) : 0))[0];
      if (carriers.length && crystal) game.issueAs(player, { type: 'GATHER', units: carriers.map((e) => e.id), target: crystal.id });
    }
  });

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS;
    controls.update(dt);
    const alpha = game.frame(dt);
    view.sync(game.world, game.prev, alpha, controls.selected, performance.now(), dt, game.events);
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
