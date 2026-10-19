// Gate 0 shell: proves the asset contract on the real GPU. Not game code yet.
import { Application, Assets, Container, Sprite, Texture, TilingSprite } from 'pixi.js';
import { loadAtlasGroups, loadManifest, type AssetRecord } from './client/render/assets';

const status = document.getElementById('status')!;
const gpuEl = document.getElementById('gpu')!;
const fpsEl = document.getElementById('fps')!;

function gpuName(canvas: HTMLCanvasElement): string {
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
  if (!gl) return 'WebGL unavailable';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return `${name} · max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`;
}

async function main(): Promise<void> {
  const probe = document.createElement('canvas');
  gpuEl.textContent = gpuName(probe);

  const app = new Application();
  await app.init({ resizeTo: window, background: '#2a1530', preference: 'webgl', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio, 2) });
  document.getElementById('stage')!.appendChild(app.canvas);

  const manifest = await loadManifest();
  const tex = await loadAtlasGroups(manifest, ['units_wl', 'units_col', 'buildings_wl', 'buildings_col', 'world_neutral']);
  const groundTex = await Assets.load<Texture>('assets/' + manifest.assets['tile_tissue']!.file!);

  const ground = new TilingSprite({ texture: groundTex, width: app.screen.width, height: app.screen.height });
  ground.tileScale.set(0.5);
  app.stage.addChild(ground);
  const world = new Container();
  world.sortableChildren = true;
  app.stage.addChild(world);

  const place = (id: string, x: number, y: number): Sprite => {
    const a: AssetRecord | undefined = manifest.assets[id];
    const s = new Sprite(tex.get(id) ?? Texture.WHITE);
    if (a?.anchor) s.anchor.set(a.anchor[0], a.anchor[1]);
    s.position.set(x, y);
    s.zIndex = y;
    world.addChild(s);
    return s;
  };

  // a small base scene: HQ, glucose field, workers
  const cx = app.screen.width * 0.55, cy = app.screen.height * 0.55;
  place('bld_wl_lymphnode', cx, cy);
  place('bld_wl_capillary', cx - 170, cy + 30);
  place('bld_wl_marrow', cx + 150, cy + 60);
  place('res_glucose_large', cx - 60, cy - 160);
  place('res_glucose_large', cx + 40, cy - 190);
  const bobbers: { s: Sprite; phase: number; vx: number; vy: number }[] = [];
  for (let i = 0; i < 8; i++) bobbers.push({ s: place('unit_wl_glut', cx - 90 + i * 26, cy - 100 + (i % 2) * 18), phase: i, vx: 0, vy: 0 });

  status.textContent = `${Object.keys(manifest.assets).length} נכסים נטענו. זו בדיקת תצוגה, עוד לא משחק.`;

  const unitIds = Object.keys(manifest.assets).filter((k) => /^unit_(wl|col)_/.test(k));
  document.getElementById('stress')!.addEventListener('click', () => {
    for (let i = 0; i < 200; i++) {
      const id = unitIds[i % unitIds.length]!;
      const s = place(id, Math.random() * app.screen.width, Math.random() * app.screen.height);
      if (Math.random() < 0.5) s.scale.x = -1;
      bobbers.push({ s, phase: Math.random() * 6.28, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.4 });
    }
  });

  let t = 0, acc = 0, frames = 0;
  app.ticker.add((tk) => {
    t += tk.deltaMS / 1000;
    for (const b of bobbers) {
      const flip = Math.sign(b.s.scale.x) || 1;
      const breathe = 1 + Math.sin(t * 3 + b.phase) * 0.03;
      b.s.scale.set(flip * (2 - breathe), breathe);
      b.s.x += b.vx; b.s.y += b.vy; b.s.zIndex = b.s.y;
    }
    acc += tk.deltaMS; frames++;
    if (acc > 500) { fpsEl.textContent = `${Math.round((frames * 1000) / acc)} fps · ${world.children.length} sprites`; acc = 0; frames = 0; }
  });
  addEventListener('resize', () => { ground.width = app.screen.width; ground.height = app.screen.height; });
}

main().catch((e: unknown) => { status.textContent = 'שגיאה: ' + (e instanceof Error ? e.message : String(e)); });
