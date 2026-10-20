// A skirmish on the arena: the player picks a side and the opponent's difficulty; the
// other side is played by the AI under the same rules.

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
import { AiPlayer } from './match/aiPlayer';
import type { Difficulty } from './ai/types';

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
    // only the first page of each effect set: harvest, ATP, growth, impacts and deaths live there
    loadAtlasGroups(manifest, ['units_wl', 'units_col', 'buildings_wl', 'buildings_col', 'world_neutral', 'icons', 'fx_a:0', 'fx_b:0', 'fx_c:0']),
    loadImage('assets/' + manifest.assets['tile_tissue']!.file),
    loadImage('assets/' + manifest.assets['tile_blood']!.file),
    loadImage('assets/' + manifest.assets['tile_bone']!.file),
  ]);

  // the menu: a side, a difficulty, the test lab
  const choice = { faction: 'wl', level: 'normal' as Difficulty };
  const pick = (cls: string, attr: string, set: (v: string) => void) => {
    const btns = [...document.querySelectorAll<HTMLButtonElement>(`#start .${cls}`)];
    for (const b of btns) {
      b.addEventListener('click', () => {
        for (const o of btns) o.setAttribute('aria-pressed', String(o === b));
        set(b.dataset[attr]!);
      });
    }
  };
  pick('side', 'faction', (v) => (choice.faction = v));
  pick('level', 'level', (v) => (choice.level = v as Difficulty));
  status.textContent = '';
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  startBtn.disabled = false;
  startBtn.focus();
  await new Promise<void>((res) => startBtn.addEventListener('click', () => res(), { once: true }));
  const dev = (document.getElementById('pick-dev') as HTMLInputElement).checked;

  status.textContent = 'בונה את הזירה…';
  const catalog = loadCatalog();
  const map = loadMap('arena');
  const ctx = createContext(catalog, map);
  const other = choice.faction === 'wl' ? 'col' : 'wl';
  // the player is always player 1 at the western start; the AI is player 2
  const ai = AiPlayer.create(2, other, choice.level, map.starts[1]!);
  const game = new Game(
    ctx,
    {
      seed: (Date.now() >>> 0) % 1_000_000,
      map: map.id,
      dev,
      players: [
        { faction: choice.faction as 'wl' | 'col', team: 1, startTile: map.starts[0]! },
        { faction: other as 'wl' | 'col', team: 2, startTile: map.starts[1]! },
      ],
    },
    1,
    [ai],
  );
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
  // the placement preview reacts only to what the player can see
  const placer = new Placer(game, textures, (e) => view.sees(game.world, e));
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
  const icons = { atp: iconOf('icon_atp'), advanced: iconOf(choice.faction === 'wl' ? 'icon_amino' : 'icon_iron') };
  const card = new CommandCard(game, controls, placer, iconOf);
  const hud = new Hud(game, controls, view, gpu, { spawn: [(sx + 8) * 256, (sy + 6) * 256], depot: [16 * 256 + 128, 10 * 256 + 128] }, icons);
  document.getElementById('dev')!.hidden = !dev;

  document.getElementById('start')!.hidden = true;
  status.textContent = '';
  // the player's carriers start mining the nearest crystal, and new ones go there too
  const carriers = game.world.entities.filter((e) => e.owner === 1 && (catalog.units.get(e.type)?.carry ?? 0) > 0);
  const hq = game.world.entities.find((e) => e.owner === 1 && e.building);
  const crystal = game.world.entities
    .filter((e) => e.res && e.res.field > 0)
    .sort((a, b) => (hq ? Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y) : 0))[0];
  if (carriers.length && crystal) game.issue({ type: 'GATHER', units: carriers.map((e) => e.id), target: crystal.id });
  if (hq && crystal) game.issue({ type: 'SET_RALLY', units: [], building: hq.id, x: crystal.x, y: crystal.y, target: crystal.id });

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
  (window as unknown as { hostwars: unknown }).hostwars = { game, view, controls, placer, card, ai, assets: Assets };
}

main().catch((e: unknown) => {
  status.textContent = 'שגיאה בטעינה: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
});
