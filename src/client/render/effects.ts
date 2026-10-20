// What a fight looks like: projectiles in flight, a burst where each blow lands, a flash on
// the one hit, and a little farewell where something dies. Everything here follows the
// simulation's events and state; nothing here decides anything. Only what the player can
// see is shown.

import { AnimatedSprite, Container, Graphics, type Texture } from 'pixi.js';
import type { SimContext } from '../../sim/context';
import { entityById, type World } from '../../sim/core/world';
import type { SimEvent } from '../../sim/sim';
import type { Manifest } from './assets';

const PX = 32 / 256;
const MAX_LIVE = 60;

/** The burst drawn where each weapon lands. */
const IMPACT: Record<string, string> = {
  w_neutrophil_claw: 'fx_pinkburst',
  w_monocyte_nip: 'fx_pinkburst',
  w_coccus_bite: 'fx_pinkburst',
  w_flagellate_bite: 'fx_pinkburst',
  w_spiro_drill: 'fx_pinkburst',
  w_strep_whip: 'fx_strep_whip',
  w_eos_granule: 'fx_eos_grenade',
  w_macro_engulf: 'fx_phagocytosis',
  w_plasma_volley: 'fx_antibody_volley',
  w_histamine: 'fx_histamine_pulse',
  w_toxin_spit: 'fx_toxin_cloud',
  w_toxin_spray: 'fx_toxin_cloud',
};

const SHOT_COLOUR: Record<string, number> = {
  w_eos_granule: 0xff6fa8,
  w_plasma_volley: 0xffd34d,
  w_toxin_spit: 0x9be15d,
};

export class CombatEffects {
  readonly layer = new Container();
  private readonly shots = new Graphics();
  private readonly live: AnimatedSprite[] = [];
  private readonly frames = new Map<string, Texture[]>();

  constructor(
    private readonly ctx: SimContext,
    manifest: Manifest,
    textures: Map<string, Texture>,
  ) {
    this.layer.addChild(this.shots);
    for (const id of new Set([...Object.values(IMPACT), 'fx_death_immune', 'fx_death_bacteria', 'fx_building_collapse'])) {
      const f = (manifest.assets[id]?.frames ?? []).map((n) => textures.get(n)).filter((t): t is Texture => t !== undefined);
      if (f.length) this.frames.set(id, f);
    }
  }

  private play(id: string, x: number, y: number, scale: number): void {
    const f = this.frames.get(id);
    if (!f || this.live.length >= MAX_LIVE) return;
    const s = new AnimatedSprite(f);
    s.anchor.set(0.5, 0.7);
    s.scale.set(scale);
    s.loop = false;
    s.animationSpeed = 14 / 60;
    s.position.set(x, y);
    s.onComplete = () => {
      s.destroy();
      const k = this.live.indexOf(s);
      if (k >= 0) this.live.splice(k, 1);
    };
    s.play();
    this.layer.addChild(s);
    this.live.push(s);
  }

  /**
   * Per frame. `sees(x, y)` says whether the player sees that point (sub-tiles); `flash(id)`
   * makes a body blink. `t` is the simulation time in ticks, with the fraction into the next.
   */
  update(world: World, events: SimEvent[], t: number, sees: (x: number, y: number) => boolean, flash: (id: number) => void): void {
    const engulfed = new Set<number>();
    for (const ev of events) {
      if (ev.type === 'engulfed') engulfed.add(ev.target);
      if (ev.type === 'hit' && sees(ev.x, ev.y)) {
        flash(ev.target);
        const fx = IMPACT[ev.weapon];
        if (fx && fx !== 'fx_phagocytosis') this.play(fx, ev.x * PX, ev.y * PX - 10, fx === 'fx_pinkburst' ? 0.35 : 0.55);
      }
      if (ev.type === 'died' && ev.cause === 'damage' && sees(ev.x, ev.y)) {
        const x = ev.x * PX;
        const y = ev.y * PX;
        if (engulfed.has(ev.entity)) this.play('fx_phagocytosis', x, y - 8, 0.6);
        else if (this.ctx.catalog.buildings.has(ev.entityType)) this.play('fx_building_collapse', x, y, 1.1);
        else this.play(ev.entityType.startsWith('unit_wl') ? 'fx_death_immune' : 'fx_death_bacteria', x, y - 6, 0.6);
      }
    }
    // projectiles in flight, from where they left towards where their target is now
    const g = this.shots;
    g.clear();
    for (const p of world.projectiles) {
      if (p.impact <= p.launch) continue;
      const tgt = entityById(world, p.target);
      const tx = tgt ? tgt.x : p.x;
      const ty = tgt ? tgt.y : p.y;
      if (!sees(p.fromX, p.fromY) && !sees(tx, ty)) continue;
      const k = Math.min(1, Math.max(0, (t - p.launch) / (p.impact - p.launch)));
      const x = (p.fromX + (tx - p.fromX) * k) * PX;
      const y = (p.fromY + (ty - p.fromY) * k) * PX - 14 - Math.sin(k * Math.PI) * 18;
      const c = SHOT_COLOUR[p.weapon] ?? 0xffffff;
      g.circle(x, y, 6).fill({ color: c, alpha: 0.35 });
      g.circle(x, y, 3.5).fill({ color: c });
    }
  }
}
