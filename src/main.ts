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
import { loadMission, missions } from './sim/content/load';
import { missionSetup, startMission } from './sim/mission/mission';
import { chooseMatch, fromAddress, playStory, type Choice } from './client/ui/menu';
import { MissionHud } from './client/ui/missionHud';

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

  // the menu: campaign or skirmish (or the mission asked for in the address: "next mission", "try again")
  status.textContent = '';
  const choice: Choice = fromAddress() ?? (await chooseMatch(missions));
  document.getElementById('start')!.hidden = true;
  const dev = choice.dev;
  const def = choice.kind === 'mission' ? loadMission(choice.id) : null;
  if (def) await playStory(def);

  status.textContent = 'בונה את הזירה…';
  const catalog = loadCatalog();
  const map = loadMap(def ? def.map : 'arena');
  const ctx = createContext(catalog, map, def);
  const seed = (Date.now() >>> 0) % 1_000_000;
  let game: Game;
  let ai: AiPlayer | null = null;
  if (def) {
    // a mission: the player is the White Line; the enemy has an AI only if the mission says so
    const world = startMission(ctx, seed);
    world.dev = dev;
    if (def.enemy.ai) ai = AiPlayer.create(2, def.enemy.faction, def.enemy.ai, map.starts[1]!);
    game = new Game(ctx, missionSetup(ctx, seed), 1, ai ? [ai] : [], world);
  } else {
    const sk = choice as Extract<Choice, { kind: 'skirmish' }>;
    const other = sk.faction === 'wl' ? 'col' : 'wl';
    // the player is always player 1 at the western start; the AI is player 2
    ai = AiPlayer.create(2, other, sk.level, map.starts[1]!);
    game = new Game(
      ctx,
      {
        seed,
        map: map.id,
        dev,
        players: [
          { faction: sk.faction, team: 1, startTile: map.starts[0]! },
          { faction: other, team: 2, startTile: map.starts[1]! },
        ],
      },
      1,
      [ai],
    );
  }
  const myFaction = game.world.players[0]!.faction;
  // a painted map is its own ground; the arena is drawn from tiles
  const terrain = map.art ? Texture.from(await loadImage('assets/' + manifest.assets[map.art]!.file)) : Texture.from(drawTerrain(map, ctx.nav, { ground, blood, wall }));
  const shapes = makeShapes(app.renderer);
  const view = new WorldView(ctx, manifest, textures, shapes, terrain);
  app.stage.addChild(view.root);
  const screen = new Container();
  const box = new Graphics();
  screen.addChild(box);
  app.stage.addChild(screen);

  const cam = new Camera(map.w * TILE_PX, map.h * TILE_PX);
  const [sx, sy] = def ? def.camera : map.starts[0]!;
  cam.centreOn((sx + (def ? 0 : 2)) * TILE_PX, (sy + (def ? 0 : 2)) * TILE_PX, app.screen.width, app.screen.height);
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
  const icons = { atp: iconOf('icon_atp'), advanced: iconOf(myFaction === 'wl' ? 'icon_amino' : 'icon_iron') };
  const card = new CommandCard(game, controls, placer, iconOf);
  const hud = new Hud(game, controls, view, gpu, { spawn: [(sx + 8) * 256, (sy + 6) * 256], depot: [16 * 256 + 128, 10 * 256 + 128] }, icons);
  document.getElementById('dev')!.hidden = !dev;

  status.textContent = '';
  const missionHud = def ? new MissionHud(game, def, view, missions[missions.indexOf(def) + 1] ?? null) : null;
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
    missionHud?.update(dt);
    card.update();
  });

  // expose for quick checks from the browser console
  (window as unknown as { hostwars: unknown }).hostwars = { game, view, controls, placer, card, ai, assets: Assets };
}

main().catch((e: unknown) => {
  status.textContent = 'שגיאה בטעינה: ' + (e instanceof Error ? e.message : String(e));
  console.error(e);
});
