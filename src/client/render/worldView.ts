// Draws the world: terrain, current, units and buildings, selection, debug layers.
// Reads the simulation's state; never writes it. Positions are interpolated between the
// previous and the current tick, so 20 ticks a second still look smooth at 60 fps.

import { Container, Graphics, Sprite, type Texture, TilingSprite } from 'pixi.js';
import type { Entity, World } from '../../sim/core/world';
import type { SimContext } from '../../sim/context';
import type { AssetRecord, Manifest } from './assets';
import type { Shapes } from './shapes';
import { TILE_PX } from './terrain';

/** sub-tiles to world pixels */
export const PX = TILE_PX / 256;
export const TEAM_COLOR: Record<number, number> = { 1: 0x4a9bff, 2: 0xf2b705, 0: 0xc2416b };

interface View {
  body: Sprite;
  shadow: Sprite | null;
  ring: Sprite | null;
  mark: Sprite | null;
  rec: AssetRecord | undefined;
  facing: 1 | -1;
  lastX: number;
  lastY: number;
  phase: number;
  moving: number; // 0..1, eased
}

export interface Marker {
  x: number;
  y: number;
  born: number;
}

export class WorldView {
  readonly root = new Container();
  private readonly ground = new Container();
  private readonly underlay = new Container();
  private readonly bodies = new Container();
  private readonly overlay = new Container();
  readonly debug = new Graphics();
  private readonly debugGrid = new Graphics();
  private debugGridVersion = -1;
  private readonly markers: { s: Sprite; m: Marker }[] = [];
  private readonly views = new Map<number, View>();
  private readonly flows: { t: TilingSprite; vx: number; vy: number }[] = [];
  debugOn = false;

  constructor(
    private readonly ctx: SimContext,
    private readonly manifest: Manifest,
    private readonly textures: Map<string, Texture>,
    private readonly shapes: Shapes,
    terrain: Texture,
  ) {
    this.bodies.sortableChildren = true;
    this.root.addChild(this.ground, this.debugGrid, this.underlay, this.bodies, this.overlay, this.debug);
    this.ground.addChild(new Sprite(terrain));
    for (const f of ctx.map.flows) {
      const [x, y, w, h] = f.rect;
      const t = new TilingSprite({ texture: shapes.chevron, width: w * TILE_PX, height: h * TILE_PX });
      t.position.set(x * TILE_PX, y * TILE_PX);
      t.tileRotation = Math.atan2(f.dir[1], f.dir[0]) - Math.PI / 2;
      t.alpha = 0.8;
      const len = Math.hypot(f.dir[0], f.dir[1]) || 1;
      const speed = 24 + (f.strength / 1000) * 40; // px per second, for show only
      this.ground.addChild(t);
      this.flows.push({ t, vx: (f.dir[0] / len) * speed, vy: (f.dir[1] / len) * speed });
    }
  }

  private makeView(e: Entity): View {
    const rec = this.manifest.assets[e.type];
    const tex = this.textures.get(e.type);
    const body = new Sprite(tex ?? this.shapes.dot);
    if (!tex) {
      body.tint = 0xff00ff;
      body.width = 24;
      body.height = 24;
    }
    body.anchor.set(rec?.anchor?.[0] ?? 0.5, rec?.anchor?.[1] ?? 0.5);
    this.bodies.addChild(body);
    let shadow: Sprite | null = null;
    let ring: Sprite | null = null;
    let mark: Sprite | null = null;
    if (!e.building) {
      shadow = new Sprite(this.shapes.shadow);
      shadow.anchor.set(0.5);
      const w = (rec?.w ?? 46) * 0.9;
      shadow.width = w;
      shadow.height = w * 0.42;
      this.underlay.addChild(shadow);
      ring = new Sprite(this.shapes.ring);
      ring.anchor.set(0.5);
      ring.tint = TEAM_COLOR[e.owner] ?? 0xffffff;
      ring.visible = false;
      this.underlay.addChild(ring);
      mark = new Sprite(e.owner === 1 ? this.shapes.markCircle : this.shapes.markDiamond);
      mark.anchor.set(0.5);
      mark.scale.set(0.5);
      mark.tint = TEAM_COLOR[e.owner] ?? 0xffffff;
      this.overlay.addChild(mark);
    }
    return { body, shadow, ring, mark, rec, facing: 1, lastX: e.x, lastY: e.y, phase: (e.id * 1.37) % 6.28, moving: 0 };
  }

  private dropView(v: View): void {
    v.body.destroy();
    v.shadow?.destroy();
    v.ring?.destroy();
    v.mark?.destroy();
  }

  addMarker(m: Marker): void {
    const s = new Sprite(this.shapes.ring);
    s.anchor.set(0.5);
    s.tint = 0x7ee081;
    this.overlay.addChild(s);
    this.markers.push({ s, m });
  }

  /** Called every frame. `prev` holds positions before the last tick; `alpha` is how far into the next tick we are. */
  sync(world: World, prev: Map<number, [number, number]>, alpha: number, selected: Set<number>, timeMs: number, dtMs: number): void {
    const seen = new Set<number>();
    const t = timeMs / 1000;
    for (const e of world.entities) {
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = this.makeView(e);
        this.views.set(e.id, v);
      }
      const p = prev.get(e.id);
      const x = (p ? p[0] + (e.x - p[0]) * alpha : e.x) * PX;
      const y = (p ? p[1] + (e.y - p[1]) * alpha : e.y) * PX;
      if (e.building) {
        v.body.position.set(x, y);
        v.body.zIndex = y;
        continue;
      }
      const dx = x - v.lastX;
      const dy = y - v.lastY;
      const speed = Math.hypot(dx, dy) / Math.max(1, dtMs) * 1000; // px per second
      v.moving += ((speed > 6 ? 1 : 0) - v.moving) * Math.min(1, dtMs / 120);
      if (dx > 0.3) v.facing = -1; // art faces left; flip to face right
      else if (dx < -0.3) v.facing = 1;
      v.lastX = x;
      v.lastY = y;
      // procedural life: breathing at rest, a little hop while walking
      const breathe = Math.sin(t * 2.6 + v.phase) * 0.03 * (1 - v.moving);
      const hop = Math.abs(Math.sin(t * 9 + v.phase)) * 3 * v.moving;
      const squash = Math.abs(Math.sin(t * 9 + v.phase)) * 0.05 * v.moving;
      v.body.position.set(x, y - hop);
      v.body.scale.set(v.facing * (1 + squash - breathe * 0.5), 1 + breathe - squash);
      v.body.zIndex = y;
      v.shadow!.position.set(x, y);
      v.shadow!.alpha = 1 - hop / 8;
      const sel = selected.has(e.id);
      v.ring!.visible = sel;
      if (sel) {
        const r = (this.ctx.catalog.units.get(e.type)?.radius ?? 115) * PX * 1.6;
        v.ring!.position.set(x, y);
        v.ring!.width = r * 2;
        v.ring!.height = r * 0.9;
      }
      const h = (v.rec?.h ?? 46) * (v.rec?.anchor?.[1] ?? 0.9);
      v.mark!.position.set(x, y - h - 8 - hop);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.dropView(v);
        this.views.delete(id);
      }
    }
    for (const f of this.flows) {
      f.t.tilePosition.x += (f.vx * dtMs) / 1000;
      f.t.tilePosition.y += (f.vy * dtMs) / 1000;
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const { s, m } = this.markers[i]!;
      const age = (timeMs - m.born) / 600;
      if (age >= 1) {
        s.destroy();
        this.markers.splice(i, 1);
        continue;
      }
      s.position.set(m.x, m.y);
      s.width = 70 * (1 - age * 0.6);
      s.height = 30 * (1 - age * 0.6);
      s.alpha = 1 - age;
    }
    this.drawDebug(world, selected);
  }

  private drawDebug(world: World, selected: Set<number>): void {
    const g = this.debug;
    g.clear();
    this.debugGrid.visible = this.debugOn;
    if (!this.debugOn) return;
    const nav = this.ctx.nav;
    if (this.debugGridVersion !== nav.version) {
      // blocked tiles red, tiles too narrow for large bodies amber; redrawn only when the grid changes
      const dg = this.debugGrid;
      dg.clear();
      for (let y = 0; y < nav.h; y++) {
        for (let x = 0; x < nav.w; x++) {
          const i = y * nav.w + x;
          if (nav.blocked(x, y)) dg.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0xe8173f, alpha: 0.28 });
          else if (nav.clearance[i]! < 2) dg.rect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0xf2b705, alpha: 0.12 });
        }
      }
      this.debugGridVersion = nav.version;
    }
    // paths of selected units, or all moving units when nothing is selected
    for (const e of world.entities) {
      if (!e.mv) continue;
      if (selected.size > 0 && !selected.has(e.id)) continue;
      const mv = e.mv;
      if (mv.waiting) {
        g.circle(e.x * PX, e.y * PX, 6).fill({ color: 0xffffff, alpha: 0.8 });
        continue;
      }
      g.moveTo(e.x * PX, e.y * PX);
      for (let k = mv.i; k < mv.path.length; k += 2) g.lineTo(mv.path[k]! * PX, mv.path[k + 1]! * PX);
      g.stroke({ width: 2, color: e.owner === 1 ? 0x9fd0ff : 0xffe27a, alpha: 0.9 });
      g.circle(mv.gx * PX, mv.gy * PX, 4).fill({ color: 0x7ee081, alpha: 0.9 });
    }
  }
}
