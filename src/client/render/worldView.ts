// Draws the world: terrain, current, units, buildings and resources, selection, the economy
// at a glance (loads, harvest sparkle, "+10" at the dropoff, saturation over each field) and
// debug layers. Reads the simulation's state; never writes it. Positions are interpolated
// between the previous and the current tick, so 20 ticks a second still look smooth at 60 fps.

import { AnimatedSprite, Container, Graphics, Sprite, Text, type Texture, TilingSprite } from 'pixi.js';
import { entityById, type Entity, type Memory, type World } from '../../sim/core/world';
import { allied, canSee } from '../../sim/vision/vision';
import { CombatEffects } from './effects';
import { FogLayer } from './fog';
import { BiofilmLayer, PusLayer } from './biofilmLayer';
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
  art: string;
  damaged: boolean;
  shown: boolean;
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
  private readonly growFrames: Texture[];
  /** hit point and growth bars, redrawn every frame */
  private readonly bars = new Graphics();
  debugOn = false;
  /** the player whose economy is shown (loads, popups, saturation) */
  me = 1;
  /** the inspected building or resource, outlined */
  inspected: number | null = null;
  private readonly inspectBox = new Graphics();
  readonly fog: FogLayer;
  readonly biofilm: BiofilmLayer;
  readonly pus: PusLayer;
  /** a mission's exit gates (tiles) and the inflammation that opens each */
  gates: { at: [number, number]; infl: number }[] = [];
  private readonly gateMarks = new Graphics();
  readonly effects: CombatEffects;
  /** bodies blinking after a hit: id → until (ms) */
  private readonly flashes = new Map<number, number>();
  /** buildings remembered after they were destroyed out of sight: drawn from memory */
  private readonly ghosts = new Map<number, Sprite>();
  private memo = new Map<number, Memory>();
  private now = 0;

  constructor(
    private readonly ctx: SimContext,
    private readonly manifest: Manifest,
    private readonly textures: Map<string, Texture>,
    private readonly shapes: Shapes,
    terrain: Texture,
  ) {
    this.bodies.sortableChildren = true;
    this.fog = new FogLayer(ctx);
    this.biofilm = new BiofilmLayer(ctx);
    this.effects = new CombatEffects(ctx, manifest, textures);
    this.pus = new PusLayer(ctx);
    this.root.addChild(this.ground, this.biofilm.sprite, this.pus.sprite, this.gateMarks, this.debugGrid, this.underlay, this.inspectBox, this.bodies, this.effects.layer, this.overlay, this.fog.sprite, this.debug);
    // the ground: the arena's tiles, or a mission's painting stretched over the map
    const ground = new Sprite(terrain);
    ground.width = ctx.map.w * TILE_PX;
    ground.height = ctx.map.h * TILE_PX;
    this.ground.addChild(ground);
    // a painted map shows its own currents; the chevrons are for tiled maps
    for (const f of ctx.map.art ? [] : ctx.map.flows) {
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
    this.growFrames = frames('fx_build_grow');
    this.overlay.addChild(this.bars);
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
    // a building may borrow another's art at its own scale (the outpost is a small lymph node)
    const bdef = this.ctx.catalog.buildings.get(e.type);
    const art = bdef?.art ?? e.type;
    const rec = this.manifest.assets[art];
    const tex = this.textures.get(art);
    const body = new Sprite(tex ?? this.shapes.dot);
    if (!tex) {
      body.tint = 0xff00ff;
      body.width = 24;
      body.height = 24;
    } else if (bdef) body.scale.set(bdef.artScale / 1000);
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
      lastX: e.x, lastY: e.y, phase: (e.id * 1.37) % 6.28, moving: 0, baseScale: body.scale.x, art, damaged: false, shown: true,
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

  /** Does the player see this entity now? Their own and their allies' always; the test lab can reveal all. */
  sees(world: World, e: Entity): boolean {
    if (this.fog.off || allied(world, e.owner, this.me) && e.owner !== 0) return true;
    return canSee(this.ctx, this.me, e);
  }

  /** Whether the player sees a point (sub-tiles). */
  seesPoint(x: number, y: number): boolean {
    return this.fog.off || this.ctx.vision.sees(this.me, Math.floor(x / 256), Math.floor(y / 256));
  }

  private show(v: View, on: boolean): void {
    if (v.shown === on) return;
    v.shown = on;
    v.body.visible = on;
    if (v.shadow) v.shadow.visible = on;
    if (v.mark) v.mark.visible = on;
    if (v.cargo) v.cargo.visible = on;
    if (v.fx) v.fx.visible = on;
    if (v.ring && !on) v.ring.visible = false;
  }

  /** Called every frame. `prev` holds positions before the last tick; `alpha` is how far into the next tick we are. */
  sync(world: World, prev: Map<number, [number, number]>, alpha: number, selected: Set<number>, timeMs: number, dtMs: number, events: SimEvent[]): void {
    const seen = new Set<number>();
    const t = timeMs / 1000;
    this.now = timeMs;
    const { catalog } = this.ctx;
    this.memo = new Map((world.memory[this.me - 1] ?? []).map((m) => [m.id, m]));
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
      const visible = this.sees(world, e);
      if (e.building) {
        // a building out of sight is drawn as last seen (greyed); one never seen, not at all.
        // Crystals never seen are drawn as the map shows them: full.
        const mem = visible ? undefined : this.memo.get(e.id);
        const rd = catalog.resources.get(e.type);
        this.show(v, visible || mem !== undefined || (rd !== undefined && e.owner === 0));
        if (!v.shown) continue;
        v.body.position.set(x, y);
        v.body.zIndex = y;
        v.body.tint = visible ? 0xffffff : 0x9a8c96;
        if (catalog.buildings.has(e.type)) {
          if (visible) this.syncBuilding(e, v, x, y, t);
          else this.syncBuilding({ ...e, hp: mem!.hp, build: mem!.growing ? e.build : null }, v, x, y, t);
          const flash = this.flashes.get(e.id);
          if (flash && flash > timeMs && visible) v.body.tint = 0xff9a9a;
        }
        if (rd && e.res) {
          // a crystal shrinks as it is worked (as last seen); a deposit is hidden under its extractor
          const stock = visible ? e.res.stock : (mem?.stock ?? rd.stock);
          const left = stock / rd.stock;
          const s = v.baseScale * (0.62 + 0.38 * Math.sqrt(left));
          v.body.scale.set(s);
          v.body.visible = e.res.link === 0 || !visible;
          v.body.zIndex = y - 1;
        }
        continue;
      }
      this.show(v, visible);
      if (!visible) continue;
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
      // procedural life: breathing at rest, a little hop while walking, a bob while harvesting,
      // a slow swell while turning into another unit
      const working = g?.st === 'harvest' || e.job !== null;
      const flash = this.flashes.get(e.id);
      if (flash && flash > timeMs) v.body.tint = 0xff8080;
      else if (e.morph) v.body.tint = 0xffffff - Math.floor((0.5 + 0.5 * Math.sin(t * 6)) * 0x30) * 0x010100;
      else if (v.body.tint !== 0xffffff) v.body.tint = 0xffffff;
      // winding up: a little lean towards the target
      const cb = e.cb;
      const foe = cb && cb.windupEnd >= 0 && cb.target ? entityById(world, cb.target) : undefined;
      if (foe) v.facing = foe.x > e.x ? -1 : 1;
      const lean = foe ? 3 : 0;
      const breathe = Math.sin(t * (working ? 7 : 2.6) + v.phase) * (working ? 0.06 : 0.03) * (1 - v.moving);
      const hop = Math.abs(Math.sin(t * 9 + v.phase)) * 3 * v.moving;
      const squash = Math.abs(Math.sin(t * 9 + v.phase)) * 0.05 * v.moving;
      v.body.position.set(x - v.facing * lean, y - hop);
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
    // buildings destroyed out of sight: still standing in the player's memory
    for (const [id, m] of this.memo) {
      if (seen.has(id) || this.fog.off) continue;
      let gs = this.ghosts.get(id);
      if (!gs) {
        const bdef = catalog.buildings.get(m.type);
        const art = bdef?.art ?? m.type;
        gs = new Sprite(this.textures.get(art) ?? this.shapes.dot);
        const rec = this.manifest.assets[art];
        gs.anchor.set(rec?.anchor?.[0] ?? 0.5, rec?.anchor?.[1] ?? 0.5);
        gs.scale.set((bdef?.artScale ?? 1000) / 1000);
        gs.tint = 0x9a8c96;
        gs.position.set(m.x * PX, m.y * PX);
        gs.zIndex = m.y * PX;
        this.bodies.addChild(gs);
        this.ghosts.set(id, gs);
      }
    }
    for (const [id, gs] of this.ghosts) {
      if (this.memo.has(id) && !seen.has(id) && !this.fog.off) continue;
      gs.destroy();
      this.ghosts.delete(id);
    }
    // the fight
    this.effects.update(world, events, world.tick - 1 + alpha, (x, y) => this.seesPoint(x, y), (id) => this.flashes.set(id, timeMs + 120));
    if (this.flashes.size > 200) for (const [id, until] of this.flashes) if (until < timeMs) this.flashes.delete(id);
    this.fog.update(world, this.me);
    this.biofilm.update(world, this.me, this.fog.off);
    this.pus.update(world, this.me, this.fog.off);
    // exit gates: open ones glow and breathe, closed ones (more inflammation needed) are dim
    const gm = this.gateMarks;
    gm.clear();
    const infl = world.host?.infl ?? 0;
    const beat = 0.5 + 0.5 * Math.sin(timeMs / 300);
    for (const g of this.gates) {
      const cx = g.at[0] * TILE_PX + TILE_PX / 2;
      const cy = g.at[1] * TILE_PX + TILE_PX / 2;
      if (infl >= g.infl) {
        gm.circle(cx, cy, 13 + beat * 4).fill({ color: 0xff5c8a, alpha: 0.18 + beat * 0.12 }).stroke({ width: 2, color: 0xffd0e0, alpha: 0.9 });
        gm.circle(cx, cy, 5).fill({ color: 0xffffff, alpha: 0.9 });
      } else gm.circle(cx, cy, 11).stroke({ width: 2, color: 0xffffff, alpha: 0.25 });
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
    this.drawBars(world, selected);
    this.drawDebug(world, selected);
  }

  /** Growing buildings fade in with a growth sparkle; badly damaged ones show their damaged art. */
  private syncBuilding(e: Entity, v: View, x: number, y: number, t: number): void {
    const g = e.build;
    if (g) {
      v.body.alpha = 0.5 + (0.5 * g.progress) / g.total;
      if (!v.fx && this.growFrames.length) {
        v.fx = new AnimatedSprite(this.growFrames);
        v.fx.anchor.set(0.5, 0.8);
        v.fx.animationSpeed = 10 / 60;
        v.fx.play();
        this.bodies.addChild(v.fx);
      }
      if (v.fx) {
        v.fx.position.set(x, y);
        v.fx.zIndex = y + 2;
        v.fx.alpha = 0.7 + 0.3 * Math.sin(t * 3);
      }
    } else {
      v.body.alpha = 1;
      if (v.fx) {
        v.fx.destroy();
        v.fx = null;
      }
    }
    const damaged = !g && e.hp * 2 < e.maxHp;
    if (damaged !== v.damaged) {
      const tex = this.textures.get(damaged ? `${v.art}_dmg` : v.art);
      if (tex) v.body.texture = tex;
      v.damaged = damaged;
    }
  }

  /** Bars: hit points of hurt or selected units, of own hurt buildings; growth of growing buildings. */
  private drawBars(world: World, selected: Set<number>): void {
    const g = this.bars;
    g.clear();
    const { catalog } = this.ctx;
    for (const e of world.entities) {
      if (e.res && !catalog.buildings.has(e.type)) continue;
      if (!this.sees(world, e)) continue;
      const own = e.owner === this.me;
      const growing = e.build !== null;
      const hurt = e.hp < e.maxHp;
      const sel = selected.has(e.id) || this.inspected === e.id;
      if (!(sel || (hurt && !growing) || (growing && own))) continue;
      const fp = catalog.footprints.get(e.type);
      const w = fp ? fp[0] * TILE_PX * 0.6 : 26;
      const top = fp ? e.y * PX - fp[1] * TILE_PX * 0.5 - 22 : e.y * PX - (this.views.get(e.id)?.rec?.h ?? 46) * 0.75 - 4;
      const x0 = e.x * PX - w / 2;
      const frac = e.hp / e.maxHp;
      g.rect(x0 - 1, top - 1, w + 2, 6).fill({ color: 0x1c0f1a, alpha: 0.85 });
      g.rect(x0, top, w * frac, 4).fill({ color: frac > 0.6 ? 0x7ee081 : frac > 0.3 ? 0xffd34d : 0xe8173f });
      if (growing) {
        const b = e.build!;
        g.rect(x0 - 1, top + 5, w + 2, 5).fill({ color: 0x1c0f1a, alpha: 0.85 });
        g.rect(x0, top + 6, (w * b.progress) / b.total, 3).fill({ color: 0x5aa0ff });
      }
    }
    // the rally of the inspected building
    const b = this.inspected !== null ? entityById(world, this.inspected) : undefined;
    if (b && b.owner === this.me && b.rally) {
      const r = b.rally;
      const t = r.target ? entityById(world, r.target) : undefined;
      const rx = (t ? t.x : r.x) * PX;
      const ry = (t ? t.y : r.y) * PX;
      g.moveTo(b.x * PX, b.y * PX).lineTo(rx, ry).stroke({ width: 2, color: 0x9fd0ff, alpha: 0.7 });
      g.circle(rx, ry, 6).fill({ color: 0x9fd0ff, alpha: 0.9 });
      g.moveTo(rx, ry).lineTo(rx, ry - 20).stroke({ width: 2, color: 0xffffff });
      g.rect(rx, ry - 20, 12, 8).fill({ color: 0x5aa0ff });
    }
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
      if (e.gather && (e.owner === this.me || this.fog.off) && (selected.size === 0 || selected.has(e.id))) {
        const g2 = e.gather;
        const to = byId.get(g2.st === 'toDrop' || g2.st === 'unload' ? g2.drop : g2.target);
        if (to) {
          g.moveTo(e.x * PX, e.y * PX).lineTo(to.x * PX, to.y * PX);
          g.stroke({ width: 1, color: g2.st === 'toDrop' || g2.st === 'unload' ? 0xffd34d : 0x7ee081, alpha: 0.5 });
        }
        if (g2.st === 'harvest') g.circle(e.x * PX, e.y * PX, 9).stroke({ width: 2, color: 0x7ee081, alpha: 0.9 });
        if (g2.st === 'wait') g.circle(e.x * PX, e.y * PX, 9).stroke({ width: 2, color: 0xffb347, alpha: 0.9 });
      }
      // paths of selected units, or all of mine when nothing is selected (enemy paths only with the map revealed)
      if (!e.mv || (e.owner !== this.me && !this.fog.off)) continue;
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
