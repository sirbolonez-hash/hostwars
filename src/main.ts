// The test arena: White Line against a Colony that only mines. Select, move, gather, build,
// train; the Colony has no AI yet (gate 6).

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
import { CommandCard } from './client/ui/commandCard';
import { Placer } from './client/input/placement';

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
  const placer = new Placer(game, textures, () => true);
  view.root.addChild(placer.layer);
  const controls = new Controls(app.canvas, game, view, cam, box, placer);
  // icons for the DOM, cut out of the atlas once and shrunk to button size
  const iconCache = new Map<string, string>();
  const iconUrl = (id: string, size = 72): string => {
    const t = textures.get(id);
    if (!t) return '';
    const big = app.renderer.extract.canvas(new Sprite(t)) as HTMLCanvasElement;
    const small = document.createElement('canvas');
    const k = size / Math.max(big.width, big.height);
    small.width = Math.max(1, Math.round(big.width * k));
    small.height = Math.max(1, Math.round(big.height * k));
    small.getContext('2d')!.drawImage(big, 0, 0, small.width, small.height);
    return small.toDataURL('image/png');
  };
  const iconOf = (id: string): string => {
    let url = iconCache.get(id);
    if (url === undefined) {
      url = iconUrl(id);
      iconCache.set(id, url);
    }
    return url;
  };
  const icons = { atp: iconOf('icon_atp'), amino: iconOf('icon_amino') };
  const card = new CommandCard(game, controls, placer, iconOf);
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
      // new carriers from the lymph node go mining too
      if (hq && crystal) game.issueAs(player, { type: 'SET_RALLY', units: [], building: hq.id, x: crystal.x, y: crystal.y, target: crystal.id });
    }
  });

  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS;
    controls.update(dt);
    const alpha = game.frame(dt);
    view.sync(game.world, game.prev, alpha, controls.selected, performance.now(), dt, game.events);
    cam.apply(view.root);
    hud.update(dt);
    card.update();
  });

  // expose for quick checks from the browser console
  (window as unknown as { hostwars: unknown }).hostwars = { game, view, controls, placer, card, assets: Assets };
}

main().catch((e: unknown) => {
  status.textContent = 'שגיאה בטעינה: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
});
