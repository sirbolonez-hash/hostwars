// Mouse and keyboard: camera, selection, orders, control groups. Turns the player's
// intent into commands through Game.issue; never touches the world directly.

import type { Container, Graphics } from 'pixi.js';
import { footprintOrigin } from '../../sim/context';
import { entityById, type Entity } from '../../sim/core/world';
import { carryOf, isCrystal, isDeposit, isDropoffOf, isExtractor } from '../../sim/economy/gather';
import type { Game } from '../game';
import { PX, type WorldView } from '../render/worldView';
import type { Placer } from './placement';
import { TILE_PX } from '../render/terrain';

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 1.6;
const EDGE = 10;
const PAN_SPEED = 900; // screen px per second

export class Camera {
  x = 0; // world px at the screen's left edge
  y = 0;
  zoom = 1;
  constructor(private readonly worldW: number, private readonly worldH: number) {}

  clamp(viewW: number, viewH: number): void {
    const w = viewW / this.zoom;
    const h = viewH / this.zoom;
    this.x = w >= this.worldW ? (this.worldW - w) / 2 : Math.min(Math.max(this.x, 0), this.worldW - w);
    this.y = h >= this.worldH ? (this.worldH - h) / 2 : Math.min(Math.max(this.y, 0), this.worldH - h);
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [this.x + sx / this.zoom, this.y + sy / this.zoom];
  }

  apply(root: Container): void {
    root.scale.set(this.zoom);
    root.position.set(-this.x * this.zoom, -this.y * this.zoom);
  }

  centreOn(wx: number, wy: number, viewW: number, viewH: number): void {
    this.x = wx - viewW / this.zoom / 2;
    this.y = wy - viewH / this.zoom / 2;
  }
}

export class Controls {
  readonly selected = new Set<number>();
  /** a building or resource shown in the selection line (not commanded) */
  inspected: number | null = null;
  /** A pressed: the next left click attack-moves (or attacks what is under it) */
  attackMode = false;
  private readonly groups = new Map<number, number[]>();
  private dragStart: [number, number] | null = null;
  private dragging = false;
  private panning: [number, number] | null = null;
  private mouse: [number, number] = [-1, -1];
  private inside = false;
  private readonly keys = new Set<string>();
  private lastClick = { t: 0, id: -1 };
  private lastGroupKey = { t: 0, n: -1 };
  onChange: () => void = () => {};

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly game: Game,
    private readonly view: WorldView,
    readonly cam: Camera,
    private readonly box: Graphics,
    readonly placer: Placer,
  ) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointerenter', () => (this.inside = true));
    canvas.addEventListener('pointerleave', () => (this.inside = false));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private screen(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private mine(): Entity[] {
    return this.game.world.entities.filter((e) => e.owner === this.game.me && !e.building);
  }

  /** The player's unit under a world point, nearest to it, preferring the one in front. */
  private pick(wx: number, wy: number): Entity | null {
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.game.world.entities) {
      if (e.building || !this.view.sees(this.game.world, e)) continue;
      const r = Math.max(16 / this.cam.zoom, (this.game.ctx.catalog.units.get(e.type)?.radius ?? 115) * PX * 1.3);
      const cx = e.x * PX;
      const cy = e.y * PX - r * 0.6; // bodies stand on their feet; aim at the middle
      const d = Math.hypot(wx - cx, wy - cy);
      if (d <= r * 1.3 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** The building or resource under a world point: its footprint, plus the art standing above it. */
  pickBuilding(wx: number, wy: number): Entity | null {
    const ctx = this.game.ctx;
    let best: Entity | null = null;
    for (const e of this.game.world.entities) {
      if (!e.building) continue;
      if (e.owner !== 0 && !this.view.sees(this.game.world, e)) continue; // an enemy building out of sight cannot be picked
      if (e.res && e.res.link !== 0 && isDeposit(ctx, e)) continue; // hidden under its extractor
      const [tx, ty, fw, fh] = footprintOrigin(ctx, e.type, e.x, e.y);
      const x0 = tx * TILE_PX;
      const y0 = ty * TILE_PX - fh * TILE_PX * 0.5;
      if (wx >= x0 && wx < x0 + fw * TILE_PX && wy >= y0 && wy < (ty + fh) * TILE_PX) best = e;
    }
    return best;
  }

  /** What right-clicking `t` with these units would be: gathering it, or just walking there. */
  gatherTarget(units: Entity[], t: Entity | null): Entity | null {
    if (!t) return null;
    const ctx = this.game.ctx;
    const me = this.game.me;
    const carriers = units.filter((u) => carryOf(ctx, u) > 0);
    if (carriers.length === 0) return null;
    if (isCrystal(ctx, t)) return (t.res?.stock ?? 0) > 0 ? t : null;
    if (isDeposit(ctx, t)) {
      const ext = t.res && t.res.link !== 0 ? entityById(this.game.world, t.res.link) : undefined;
      return ext && ext.owner === me ? t : null;
    }
    if (isExtractor(ctx, t)) return t.owner === me && t.res?.link ? t : null;
    // own dropoff: only meaningful for carriers holding a load
    if (isDropoffOf(ctx, t, me)) return carriers.some((c) => c.cargo > 0) ? t : null;
    return null;
  }

  private down(e: PointerEvent): void {
    const [sx, sy] = this.screen(e);
    if (this.attackMode && e.button !== 1) {
      this.attackMode = false;
      this.canvas.style.cursor = 'default';
      if (e.button === 0) this.attackAt(sx, sy, true);
      return;
    }
    if (this.placer.active && e.button !== 1) {
      // placing a building: left click places, right click puts it back in the order slot
      if (e.button === 0) this.placer.click();
      else this.placer.cancel();
      return;
    }
    if (e.button === 1) {
      this.panning = [sx, sy];
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      this.order(sx, sy);
      return;
    }
    if (e.button === 0) {
      this.dragStart = [sx, sy];
      this.dragging = false;
    }
  }

  private move(e: PointerEvent): void {
    const [sx, sy] = this.screen(e);
    this.mouse = [sx, sy];
    if (this.placer.active) {
      const [wx, wy] = this.cam.toWorld(sx, sy);
      this.placer.hover(wx, wy);
      return;
    }
    if (this.attackMode) return;
    if (e.target === this.canvas && !this.dragStart) {
      // a hand over something the selected carriers can work
      const [wx, wy] = this.cam.toWorld(sx, sy);
      const sel = this.selectedUnits();
      const over = sel.length ? this.gatherTarget(sel, this.pickBuilding(wx, wy)) : null;
      this.canvas.style.cursor = over ? 'pointer' : 'default';
    }
    if (this.panning) {
      this.cam.x -= (sx - this.panning[0]) / this.cam.zoom;
      this.cam.y -= (sy - this.panning[1]) / this.cam.zoom;
      this.panning = [sx, sy];
      return;
    }
    if (this.dragStart && !this.dragging && Math.hypot(sx - this.dragStart[0], sy - this.dragStart[1]) > 5) this.dragging = true;
  }

  private up(e: PointerEvent): void {
    if (e.button === 1) {
      this.panning = null;
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const [sx, sy] = this.screen(e);
    const add = e.shiftKey;
    if (this.dragging) {
      const [ax, ay] = this.cam.toWorld(Math.min(sx, this.dragStart[0]), Math.min(sy, this.dragStart[1]));
      const [bx, by] = this.cam.toWorld(Math.max(sx, this.dragStart[0]), Math.max(sy, this.dragStart[1]));
      if (!add) this.selected.clear();
      this.inspected = null;
      for (const u of this.mine()) {
        const x = u.x * PX;
        const y = u.y * PX;
        if (x >= ax && x <= bx && y >= ay && y <= by) this.selected.add(u.id);
      }
    } else {
      const [wx, wy] = this.cam.toWorld(sx, sy);
      const hit = this.pick(wx, wy);
      const now = performance.now();
      this.inspected = null;
      if (!hit && !add) {
        // nothing to command here: show what the building or resource is
        const b = this.pickBuilding(wx, wy);
        if (b) {
          this.selected.clear();
          this.inspected = b.id;
        }
      }
      if (hit && hit.owner === this.game.me) {
        if (now - this.lastClick.t < 320 && this.lastClick.id === hit.id) {
          this.selectTypeOnScreen(hit.type);
        } else if (add) {
          if (this.selected.has(hit.id)) this.selected.delete(hit.id);
          else this.selected.add(hit.id);
        } else {
          this.selected.clear();
          this.selected.add(hit.id);
        }
        this.lastClick = { t: now, id: hit.id };
      } else if (!add) {
        this.selected.clear();
      }
    }
    this.dragStart = null;
    this.dragging = false;
    this.onChange();
  }

  private selectTypeOnScreen(type: string): void {
    const [ax, ay] = this.cam.toWorld(0, 0);
    const [bx, by] = this.cam.toWorld(this.canvas.clientWidth, this.canvas.clientHeight);
    this.selected.clear();
    for (const u of this.mine()) {
      const x = u.x * PX;
      const y = u.y * PX;
      if (u.type === type && x >= ax && x <= bx && y >= ay && y <= by) this.selected.add(u.id);
    }
  }

  private selectedUnits(): Entity[] {
    return this.liveSelection().map((id) => entityById(this.game.world, id)).filter((e): e is Entity => e !== undefined);
  }

  /** A visible enemy under a world point: a unit first, then a building. */
  private foeAt(wx: number, wy: number): Entity | null {
    const me = this.game.me;
    const u = this.pick(wx, wy);
    if (u && u.owner !== me && u.owner !== 0) return u;
    const b = this.pickBuilding(wx, wy);
    return b && b.owner !== me && b.owner !== 0 ? b : null;
  }

  /** Attack what is under the point, or (attack-move) fight one's way there. Returns false if nothing was ordered. */
  private attackAt(sx: number, sy: number, moveIfNone: boolean): boolean {
    const all = this.selectedUnits();
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const foe = this.foeAt(wx, wy);
    // dendritic cells sample an enemy instead of walking up to it
    const samplers = foe ? all.filter((u) => this.game.ctx.catalog.units.get(u.type)?.role === 'intel') : [];
    if (samplers.length) this.game.issue({ type: 'SAMPLE', units: samplers.map((u) => u.id), target: foe!.id });
    const units = all.filter((u) => !samplers.includes(u));
    const armed = units.filter((u) => u.cb !== null).map((u) => u.id);
    if (armed.length === 0) {
      if (samplers.length) this.view.addMarker({ x: wx, y: wy, born: performance.now(), color: 0xc58cff });
      return samplers.length > 0;
    }
    const rest = units.filter((u) => u.cb === null).map((u) => u.id);
    const x = Math.round(wx / PX);
    const y = Math.round(wy / PX);
    if (foe) {
      for (let k = 0; k < armed.length; k += 200) this.game.issue({ type: 'ATTACK', units: armed.slice(k, k + 200), target: foe.id });
    } else if (moveIfNone) {
      if (x < 0 || y < 0 || x >= this.game.world.mapW || y >= this.game.world.mapH) return false;
      for (let k = 0; k < armed.length; k += 200) this.game.issue({ type: 'ATTACK_MOVE', units: armed.slice(k, k + 200), x, y });
    } else return false;
    if (rest.length) this.game.issue({ type: 'MOVE', units: rest, x, y });
    this.view.addMarker({ x: wx, y: wy, born: performance.now(), color: 0xe8173f });
    return true;
  }

  /** The player's building whose rally is being set: an inspected production building of theirs. */
  private rallyBuilding(): Entity | null {
    if (this.inspected === null) return null;
    const b = entityById(this.game.world, this.inspected);
    return b && b.owner === this.game.me && b.queue ? b : null;
  }

  private order(sx: number, sy: number): void {
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const x = Math.round(wx / PX);
    const y = Math.round(wy / PX);
    if (x < 0 || y < 0 || x >= this.game.world.mapW || y >= this.game.world.mapH) return;
    const units = this.selectedUnits();
    const rb = units.length === 0 ? this.rallyBuilding() : null;
    if (rb) {
      // a production building: right click sets where new units go (a crystal: carriers mine it)
      const on = this.pick(wx, wy) ?? this.pickBuilding(wx, wy);
      const target = on && on.id !== rb.id && (on.owner === this.game.me || (on.res !== null && on.owner === 0)) ? on.id : 0;
      this.game.issue({ type: 'SET_RALLY', units: [], building: rb.id, x, y, target });
      this.view.addMarker({ x: wx, y: wy, born: performance.now(), color: 0x9fd0ff });
      return;
    }
    if (units.length === 0) return;
    // an enemy under the cursor: armed units attack it, the rest walk there
    if (this.attackAt(sx, sy, false)) return;
    const ctx = this.game.ctx;
    const on = this.pickBuilding(wx, wy);
    // builders: help a growing building of ours, or repair a damaged one; the rest walk there
    if (on && on.owner === this.game.me && ctx.catalog.buildings.has(on.type)) {
      const builders = units.filter((u) => ctx.catalog.units.get(u.type)?.role === 'builder');
      const job = on.build ? 'ASSIST_BUILD' : on.hp < on.maxHp ? 'REPAIR' : null;
      if (builders.length && job) {
        this.game.issue({ type: job, units: builders.map((u) => u.id), target: on.id });
        const rest = units.filter((u) => !builders.includes(u)).map((u) => u.id);
        if (rest.length) this.game.issue({ type: 'MOVE', units: rest, x, y });
        this.view.addMarker({ x: wx, y: wy, born: performance.now(), color: 0x9fd0ff });
        return;
      }
    }
    const target = this.gatherTarget(units, on);
    let walkers = units;
    if (target) {
      // carriers work it; everyone else walks over
      const ctx = this.game.ctx;
      const carriers = units.filter((u) => carryOf(ctx, u) > 0);
      walkers = units.filter((u) => carryOf(ctx, u) === 0);
      for (let k = 0; k < carriers.length; k += 200) this.game.issue({ type: 'GATHER', units: carriers.slice(k, k + 200).map((u) => u.id), target: target.id });
    }
    const ids = walkers.map((u) => u.id);
    for (let k = 0; k < ids.length; k += 200) this.game.issue({ type: 'MOVE', units: ids.slice(k, k + 200), x, y });
    this.view.addMarker({ x: wx, y: wy, born: performance.now(), color: target ? 0xffd34d : 0x7ee081 });
  }

  liveSelection(): number[] {
    const alive = new Set(this.game.world.entities.map((e) => e.id));
    for (const id of [...this.selected]) if (!alive.has(id)) this.selected.delete(id);
    return [...this.selected].sort((a, b) => a - b);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const [sx, sy] = this.screen(e);
    const [wx, wy] = this.cam.toWorld(sx, sy);
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    this.cam.zoom = z;
    this.cam.x = wx - sx / z;
    this.cam.y = wy - sy / z;
  }

  private keyDown(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    this.keys.add(e.code);
    const digit = /^Digit([0-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      if (e.ctrlKey || e.metaKey) {
        this.groups.set(n, this.liveSelection());
        e.preventDefault();
      } else {
        const g = (this.groups.get(n) ?? []).filter((id) => this.game.world.entities.some((x) => x.id === id));
        this.selected.clear();
        this.inspected = null;
        for (const id of g) this.selected.add(id);
        const now = performance.now();
        if (this.lastGroupKey.n === n && now - this.lastGroupKey.t < 350) this.centreOnSelection();
        this.lastGroupKey = { t: now, n };
      }
      this.onChange();
      return;
    }
    switch (e.code) {
      case 'KeyS':
        if (this.selected.size) this.game.issue({ type: 'STOP', units: this.liveSelection() });
        break;
      case 'KeyH':
        if (this.selected.size) this.game.issue({ type: 'HOLD', units: this.liveSelection() });
        break;
      case 'KeyA':
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+A: every unit of mine
          for (const u of this.mine()) this.selected.add(u.id);
          this.inspected = null;
          e.preventDefault();
          this.onChange();
        } else if (this.selectedUnits().some((u) => u.cb !== null)) {
          // A: the next left click attack-moves
          this.attackMode = true;
          this.canvas.style.cursor = 'crosshair';
        }
        break;
      case 'Escape':
        if (this.attackMode) {
          this.attackMode = false;
          this.canvas.style.cursor = 'default';
          break;
        }
        if (this.placer.active) {
          this.placer.cancel();
          break;
        }
        this.selected.clear();
        this.inspected = null;
        this.onChange();
        break;
      case 'Space':
        this.centreOnSelection();
        e.preventDefault();
        break;
      case 'F3':
      case 'Backquote':
        this.view.debugOn = !this.view.debugOn;
        e.preventDefault();
        this.onChange();
        break;
    }
  }

  centreOnSelection(): void {
    const sel = this.game.world.entities.filter((e) => this.selected.has(e.id));
    if (!sel.length) return;
    const x = (sel.reduce((s, e) => s + e.x, 0) / sel.length) * PX;
    const y = (sel.reduce((s, e) => s + e.y, 0) / sel.length) * PX;
    this.cam.centreOn(x, y, this.canvas.clientWidth, this.canvas.clientHeight);
  }

  /** Per frame: keyboard and edge panning, and the selection box. */
  update(dtMs: number): void {
    const step = (PAN_SPEED * dtMs) / 1000 / this.cam.zoom;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const [mx, my] = this.mouse;
    const edge = this.inside && !this.dragStart && !this.panning;
    if (this.keys.has('ArrowLeft') || (edge && mx >= 0 && mx < EDGE)) this.cam.x -= step;
    if (this.keys.has('ArrowRight') || (edge && mx > w - EDGE)) this.cam.x += step;
    if (this.keys.has('ArrowUp') || (edge && my >= 0 && my < EDGE)) this.cam.y -= step;
    if (this.keys.has('ArrowDown') || (edge && my > h - EDGE)) this.cam.y += step;
    this.cam.clamp(w, h);
    this.box.clear();
    if (this.dragging && this.dragStart) {
      const [ax, ay] = this.dragStart;
      this.box.rect(Math.min(ax, mx), Math.min(ay, my), Math.abs(mx - ax), Math.abs(my - ay)).fill({ color: 0x7ee081, alpha: 0.12 }).stroke({ width: 1.5, color: 0x7ee081, alpha: 0.9 });
    }
  }
}

export { TILE_PX };
