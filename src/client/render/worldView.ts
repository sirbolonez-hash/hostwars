// Draws the world: terrain, current, units, buildings and resources, selection, the economy
// at a glance (loads, harvest sparkle, "+10" at the dropoff, saturation over each field) and
// debug layers. Reads the simulation's state; never writes it. Positions are interpolated
// between the previous and the current tick, so 20 ticks a second still look smooth at 60 fps.

import { AnimatedSprite, Container, Graphics, Sprite, Text, type Texture, TilingSprite } from 'pixi.js';
import { entityById, type Entity, type World } from '../../sim/core/world';
import type { SimContext } from '../../sim/context';
import type { SimEvent } from '../../sim/sim';
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
  cargo: Sprite | null;
  cargoKind: string;
  fx: AnimatedSprite | null;
  rec: AssetRecord | undefined;
  facing: 1 | -1;
  lastX: number;
  lastY: number;
  phase: number;
  moving: number; // 0..1, eased
  baseScale: number;
}

export interface Marker {
  x: number;
  y: number;
  born: number;
  color?: number;
}

interface Popup {
  t: Text;
  born: number;
  x: number;
  y: number;
}

interface FieldLabel {
  t: Text;
  field: number;
}

const POPUP_MS = 1100;
const MAX_POPUPS = 16;

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
  private readonly popups: Popup[] = [];
  private readonly fieldLabels: FieldLabel[] = [];
  private labelClock = 0;
  private readonly harvestFrames: Texture[];
  private readonly orbFrames: Texture[];
  debugOn = false;
  /** the player whose economy is shown (loads, popups, saturation) */
  me = 1;
  /** the inspected building or resource, outlined */
  inspected: number | null = null;
  private readonly inspectBox = new Graphics();

  constructor(
    private readonly ctx: SimContext,
    private readonly manifest: Manifest,
    private readonly textures: Map<string, Texture>,
    private readonly shapes: Shapes,
    terrain: Texture,
  ) {
    this.bodies.sortableChildren = true;
    this.root.addChild(this.ground, this.debugGrid, this.underlay, this.inspectBox, this.bodies, this.overlay, this.debug);
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
    const frames = (id: string) => (manifest.assets[id]?.frames ?? []).map((n) => textures.get(n)).filter((t): t is Texture => t !== undefined);
    this.harvestFrames = frames('fx_glucose_harvest');
    this.orbFrames = frames('fx_atp_orbs');
    for (const f of ctx.map.fields) {
      const t = new Text({
        text: '',
        style: { fontFamily: 'Fredoka, Assistant, sans-serif', fontSize: 15, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x1c0f1a, width: 4 } },
      });
      t.anchor.set(0.5, 1);
      t.visible = false;
      this.overlay.addChild(t);
      this.fieldLabels.push({ t, field: f.id });
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
    return {
      body, shadow, ring, mark, cargo: null, cargoKind: '', fx: null, rec, facing: 1,
      lastX: e.x, lastY: e.y, phase: (e.id * 1.37) % 6.28, moving: 0, baseScale: body.scale.x,
    };
  }

  private dropView(v: View): void {
    v.body.destroy();
    v.shadow?.destroy();
    v.ring?.destroy();
    v.mark?.destroy();
    v.cargo?.destroy();
    v.fx?.destroy();
  }

  addMarker(m: Marker): void {
    const s = new Sprite(this.shapes.ring);
    s.anchor.set(0.5);
    s.tint = m.color ?? 0x7ee081;
    this.overlay.addChild(s);
    this.markers.push({ s, m });
  }

  /** A load's look: a little crystal for glucose, the resource icon for the rest. */
  private cargoSprite(kind: string): Sprite {
    const id = kind === 'glucose' ? 'res_glucose_small' : kind === 'protein' ? 'icon_amino' : 'icon_iron';
    const s = new Sprite(this.textures.get(id) ?? this.shapes.dot);
    s.anchor.set(0.5, 0.8);
    s.scale.set(kind === 'glucose' ? 0.42 : 0.3);
    return s;
  }

  /** Called every frame. `prev` holds positions before the last tick; `alpha` is how far into the next tick we are. */
  sync(world: World, prev: Map<number, [number, number]>, alpha: number, selected: Set<number>, timeMs: number, dtMs: number, events: SimEvent[]): void {
    const seen = new Set<number>();
    const t = timeMs / 1000;
    const { catalog } = this.ctx;
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
        const rd = catalog.resources.get(e.type);
        if (rd && e.res) {
          // a crystal shrinks as it is worked; a deposit is hidden under its extractor
          const left = e.res.stock / rd.stock;
          const s = v.baseScale * (0.62 + 0.38 * Math.sqrt(left));
          v.body.scale.set(s);
          v.body.visible = e.res.link === 0;
          v.body.zIndex = y - 1;
        }
        continue;
      }
      const dx = x - v.lastX;
      const dy = y - v.lastY;
      const speed = (Math.hypot(dx, dy) / Math.max(1, dtMs)) * 1000; // px per second
      v.moving += ((speed > 6 ? 1 : 0) - v.moving) * Math.min(1, dtMs / 120);
      if (dx > 0.3) v.facing = -1; // art faces left; flip to face right
      else if (dx < -0.3) v.facing = 1;
      v.lastX = x;
      v.lastY = y;
      // a harvesting carrier turns to its crystal
      const g = e.gather;
      const target = g && (g.st === 'harvest' || g.st === 'wait') ? entityById(world, g.target) : undefined;
      if (target && v.moving < 0.5) v.facing = target.x > e.x ? -1 : 1;
      // procedural life: breathing at rest, a little hop while walking, a bob while harvesting
      const working = g?.st === 'harvest';
      const breathe = Math.sin(t * (working ? 7 : 2.6) + v.phase) * (working ? 0.06 : 0.03) * (1 - v.moving);
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
        const r = (catalog.units.get(e.type)?.radius ?? 115) * PX * 1.6;
        v.ring!.position.set(x, y);
        v.ring!.width = r * 2;
        v.ring!.height = r * 0.9;
      }
      const h = (v.rec?.h ?? 46) * (v.rec?.anchor?.[1] ?? 0.9);
      v.mark!.position.set(x, y - h - 8 - hop);
      // the load it carries, held in front
      if (e.cargo > 0) {
        if (!v.cargo || v.cargoKind !== e.cargoKind) {
          v.cargo?.destroy();
          v.cargo = this.cargoSprite(e.cargoKind);
          v.cargoKind = e.cargoKind;
          this.bodies.addChild(v.cargo);
        }
        const w = (v.rec?.w ?? 46) * 0.32;
        v.cargo.position.set(x - v.facing * w, y - h * 0.35 - hop);
        v.cargo.zIndex = y + 0.5;
      } else if (v.cargo) {
        v.cargo.destroy();
        v.cargo = null;
        v.cargoKind = '';
      }
      // the sparkle of a harvest, between the carrier and its crystal
      if (working && target && this.harvestFrames.length) {
        if (!v.fx) {
          v.fx = new AnimatedSprite(this.harvestFrames);
          v.fx.anchor.set(0.5, 0.75);
          v.fx.animationSpeed = 12 / 60;
          v.fx.scale.set(0.55);
          v.fx.play();
          this.bodies.addChild(v.fx);
        }
        const tx = target.x * PX;
        const ty = target.y * PX;
        v.fx.position.set(x + (tx - x) * 0.45, y + (ty - y) * 0.45);
        v.fx.zIndex = y + 1;
      } else if (v.fx) {
        v.fx.destroy();
        v.fx = null;
      }
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
    this.economyEffects(world, events, timeMs);
    this.labelClock -= dtMs;
    if (this.labelClock <= 0) {
      this.labelClock = 250;
      this.updateFieldLabels(world);
    }
    this.drawInspected(world);
    this.drawDebug(world, selected);
  }

  /** "+10" and a burst of ATP where my loads come in. */
  private economyEffects(world: World, events: SimEvent[], timeMs: number): void {
    for (const ev of events) {
      if (ev.type !== 'delivered' || ev.owner !== this.me || this.popups.length >= MAX_POPUPS) continue;
      const c = entityById(world, ev.entity);
      if (!c) continue;
      const x = c.x * PX;
      const y = c.y * PX - 18;
      const t = new Text({
        text: `+${ev.amount}`,
        style: {
          fontFamily: 'Fredoka, Assistant, sans-serif', fontSize: 16, fontWeight: '600',
          fill: ev.kind === 'glucose' ? 0xffd34d : 0x9fe8a2, stroke: { color: 0x1c0f1a, width: 4 },
        },
      });
      t.anchor.set(0.5);
      this.overlay.addChild(t);
      this.popups.push({ t, born: timeMs, x, y });
      if (this.orbFrames.length && ev.kind === 'glucose') {
        const orb = new AnimatedSprite(this.orbFrames);
        orb.anchor.set(0.5, 0.8);
        orb.scale.set(0.5);
        orb.loop = false;
        orb.animationSpeed = 14 / 60;
        orb.position.set(x, y + 18);
        orb.zIndex = y + 40;
        orb.onComplete = () => orb.destroy();
        orb.play();
        this.bodies.addChild(orb);
      }
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i]!;
      const age = (timeMs - p.born) / POPUP_MS;
      if (age >= 1) {
        p.t.destroy();
        this.popups.splice(i, 1);
        continue;
      }
      p.t.position.set(p.x, p.y - age * 26);
      p.t.alpha = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
    }
  }

  /** Over each field: my carriers working it, against two per crystal (the useful maximum). */
  private updateFieldLabels(world: World): void {
    const { catalog } = this.ctx;
    for (const l of this.fieldLabels) {
      let n = 0;
      let sx = 0;
      let minY = Infinity;
      const ids = new Set<number>();
      for (const e of world.entities) {
        if (!e.res || e.res.field !== l.field || !catalog.resources.has(e.type)) continue;
        ids.add(e.id);
        n++;
        sx += e.x;
        minY = Math.min(minY, e.y);
      }
      let workers = 0;
      for (const e of world.entities) if (e.owner === this.me && e.gather && ids.has(e.gather.target)) workers++;
      if (n === 0 || workers === 0) {
        l.t.visible = false;
        continue;
      }
      const optimal = n * 2;
      l.t.visible = true;
      l.t.text = `${workers}/${optimal}`;
      l.t.style.fill = workers < n ? 0xffffff : workers <= optimal ? 0x7ee081 : 0xffb347;
      l.t.position.set((sx / n) * PX, minY * PX - 34);
    }
  }

  private drawInspected(world: World): void {
    const g = this.inspectBox;
    g.clear();
    if (this.inspected === null) return;
    const e = entityById(world, this.inspected);
    const fp = e && this.ctx.catalog.footprints.get(e.type);
    if (!e || !fp) return;
    const w = fp[0] * TILE_PX;
    const h = fp[1] * TILE_PX;
    g.ellipse(e.x * PX, e.y * PX + h * 0.25, w * 0.62, h * 0.38).stroke({ width: 2, color: TEAM_COLOR[e.owner] ?? 0xffffff, alpha: 0.9 });
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
    const byId = new Map(world.entities.map((e) => [e.id, e]));
    for (const e of world.entities) {
      // the economy: who works what (green), who is bringing a load where (gold), held slots (ring)
      if (e.gather && (selected.size === 0 || selected.has(e.id))) {
        const g2 = e.gather;
        const to = byId.get(g2.st === 'toDrop' || g2.st === 'unload' ? g2.drop : g2.target);
        if (to) {
          g.moveTo(e.x * PX, e.y * PX).lineTo(to.x * PX, to.y * PX);
          g.stroke({ width: 1, color: g2.st === 'toDrop' || g2.st === 'unload' ? 0xffd34d : 0x7ee081, alpha: 0.5 });
        }
        if (g2.st === 'harvest') g.circle(e.x * PX, e.y * PX, 9).stroke({ width: 2, color: 0x7ee081, alpha: 0.9 });
        if (g2.st === 'wait') g.circle(e.x * PX, e.y * PX, 9).stroke({ width: 2, color: 0xffb347, alpha: 0.9 });
      }
      // paths of selected units, or all moving units when nothing is selected
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
