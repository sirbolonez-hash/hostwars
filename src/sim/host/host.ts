// The host: the patient the battle is fought inside (main tab, sections 3.2 and 3.4).
//
// The monitor (missions only): inflammation rises with the immune response itself — a
// neutrophil dying (+2), a NET (+3 more), histamine (+0.4 a pulse), toxins — and ebbs by 0.3 a
// second, 0.5 more once nothing has been hit for 10 seconds, 0.2 more for every regulatory
// T cell. (The design doc's raw numbers, +0.5 a death against 0.5 a second of calm, never
// added up in fights of this size; see DECISIONS.) Its tiers decide the match:
//   0–30   calm         nothing
//   31–60  active       more exit gates open, reinforcements come 25% sooner (the sweet spot)
//   61–85  raging       the tissue takes 1% of damage a minute, the pressure falls
//   86–100 cytokine storm: 60 seconds to bring it under 85, or the patient is lost
// Fever follows inflammation (37–41 °C): at 38–39 immune cells move 10% faster and bacteria
// split 20% slower; above 40 the tissue burns twice as fast. Pressure starts at 85: under 65
// production slows by a quarter; under 50 for 60 seconds is shock, and the patient is lost.
//
// Pus (everywhere, also in skirmish): where a neutrophil dies, the tiles around it fill with
// pus for two minutes; everyone on it walks 30% slower; a macrophage standing in it cleans a
// tile a second and heals while it does.
//
// A NET: a neutrophil gives itself up and bursts into a sticky net: every enemy within 3 tiles
// is held for 6 seconds and takes 40 damage; pus is left where it burst.

import type { Cmd, RejectReason } from '../commands/commands';
import type { SimContext } from '../context';
import { SUB } from '../core/fixed';
import type { Entity, HostState, World } from '../core/world';
import { allied } from '../vision/vision';

export const INFL_MAX = 100_000;
/** points (thousandths) each thing adds to inflammation */
export const INFL_NEUTROPHIL_DEATH = 2000;
export const INFL_NET = 3000;
export const INFL_HISTAMINE = 400;
export const INFL_TOXIN = 1000;
export const INFL_TOXIN_SPRAY = 300;
/** calming per tick: always a little, more 10 s after the last hit anywhere, and per regulatory T cell */
export const INFL_CALM_AFTER = 200;
export const INFL_EBB = 15;
export const INFL_CALM = 25;
export const INFL_TREG = 10;
export const TIER_ACTIVE = 31_000;
export const TIER_RAGING = 61_000;
export const TIER_STORM = 86_000;
export const STORM_TICKS = 1200;
export const PRESSURE_START = 85_000;
export const PRESSURE_SLOW = 65_000;
export const PRESSURE_SHOCK = 50_000;
export const SHOCK_TICKS = 1200;
export const PUS_TICKS = 2400;
/** speed on pus, thousandths */
export const PUS_DRAG = 700;
export const NET_RADIUS = 3 * SUB;
export const NET_STUN = 120;
export const NET_DAMAGE = 40;

export type HostEvent =
  | { type: 'net'; entity: number; owner: number; x: number; y: number; caught: number }
  | { type: 'host_tier'; tier: number }
  | { type: 'host_lost'; reason: 'cytokine_storm' | 'shock' };

export function newHost(): HostState {
  return { infl: 0, pressure: PRESSURE_START, lastFight: -1_000_000, stormSince: -1, shockSince: -1, tissueMax: 0, tissueOwed: 0 };
}

/** 0 calm, 1 active, 2 raging, 3 storm */
export function tierOf(infl: number): number {
  return infl >= TIER_STORM ? 3 : infl >= TIER_RAGING ? 2 : infl >= TIER_ACTIVE ? 1 : 0;
}

/** Fever in tenths of a degree: 37.0–41.0. */
export function feverOf(infl: number): number {
  return 370 + Math.floor((infl * 40) / INFL_MAX);
}

/** Tissue integrity in thousandths: what is left of the host cells' hit points. */
export function tissueOf(world: World, ctx: SimContext): number {
  const h = world.host;
  if (!h || h.tissueMax === 0) return 1000;
  let hp = 0;
  for (const e of world.entities) if (e.building && e.owner === 0 && isHostCell(ctx, e)) hp += Math.max(0, e.hp);
  return Math.floor((hp * 1000) / h.tissueMax);
}

export function isHostCell(ctx: SimContext, e: Entity): boolean {
  return e.building && ctx.catalog.buildings.get(e.type)?.role === 'host';
}

/** Speed in thousandths a unit gets from the host: fever for immune cells, pus for everyone. */
export function hostSpeed(world: World, ctx: SimContext, e: Entity): number {
  let f = 1000;
  if (ctx.pus[Math.floor(e.y / SUB) * ctx.map.w + Math.floor(e.x / SUB)]) f = PUS_DRAG;
  const h = world.host;
  if (h && h.infl >= 25_000 && h.infl < 50_000 && world.players[e.owner - 1]?.faction === 'wl') f = Math.trunc((f * 1100) / 1000);
  return f;
}

/** Phase 2: the pus grid this tick, from the pus in the world (derived, never saved). */
export function computePus(world: World, ctx: SimContext): void {
  ctx.pus.fill(0);
  world.pus = world.pus.filter((p) => p.until > world.tick);
  for (const p of world.pus) ctx.pus[p.i] = 1;
  world.reveals = world.reveals.filter((r) => r.until > world.tick);
}

/** Pus on the open tiles around a point, for two minutes from now. */
export function spillPus(world: World, ctx: SimContext, x: number, y: number): void {
  const tx = Math.floor(x / SUB);
  const ty = Math.floor(y / SUB);
  const until = world.tick + PUS_TICKS;
  for (let yy = ty - 1; yy <= ty + 1; yy++) {
    for (let xx = tx - 1; xx <= tx + 1; xx++) {
      if (!ctx.nav.inBounds(xx, yy) || ctx.nav.blocked(xx, yy)) continue;
      const i = yy * ctx.map.w + xx;
      const old = world.pus.find((p) => p.i === i);
      if (old) old.until = Math.max(old.until, until);
      else world.pus.push({ i, until });
    }
  }
  world.pus.sort((a, b) => a.i - b.i);
}

// ---------------------------------------------------------------- NET

type Net = Extract<Cmd, { type: 'NET' }>;

const isNeutrophil = (ctx: SimContext, e: Entity) => !e.building && e.type === 'unit_wl_neutrophil' && e.hp > 0 && !e.morph;

export function validateNet(ctx: SimContext, units: Entity[]): RejectReason | null {
  return units.some((u) => isNeutrophil(ctx, u)) ? null : 'no_neutrophils';
}

/** Every neutrophil in the order bursts: enemies within 3 tiles held 6 s and hit for 40. */
export function applyNet(world: World, ctx: SimContext, cmd: Net, units: Entity[], events: HostEvent[]): void {
  void cmd;
  for (const n of [...units].sort((a, b) => a.id - b.id)) {
    if (!isNeutrophil(ctx, n)) continue;
    let caught = 0;
    for (const o of world.entities) {
      if (o.building || o.hp <= 0 || o.owner === 0 || allied(world, n.owner, o.owner)) continue;
      if ((o.x - n.x) ** 2 + (o.y - n.y) ** 2 > NET_RADIUS * NET_RADIUS) continue;
      o.stun = Math.max(o.stun, world.tick + NET_STUN);
      o.hp -= NET_DAMAGE;
      o.lastCombat = world.tick;
      if (o.cb) {
        o.cb.target = 0;
        o.cb.windupEnd = -1;
      }
      caught++;
    }
    n.hp = 0; // it gave itself: dies this tick, and its pus is spilled with its death
    if (world.host) {
      world.host.infl = Math.min(INFL_MAX, world.host.infl + INFL_NET);
      world.host.lastFight = world.tick;
    }
    events.push({ type: 'net', entity: n.id, owner: n.owner, x: n.x, y: n.y, caught });
  }
}

// ---------------------------------------------------------------- phase 11

/** What this tick's events did to the host, then its own course. `events` are the tick's events so far. */
export function hostPhase(
  world: World,
  ctx: SimContext,
  events: readonly { type: string; entityType?: string; weapon?: string; x?: number; y?: number }[],
  out: HostEvent[],
): void {
  const tick = world.tick;
  // pus where neutrophils died (skirmish too)
  for (const ev of events) if (ev.type === 'died' && ev.entityType === 'unit_wl_neutrophil') spillPus(world, ctx, ev.x!, ev.y!);
  // macrophages clean the pus under them, a tile a second, and heal while they do
  if (world.pus.length > 0 && tick % 20 === 0) {
    for (const e of world.entities) {
      if (e.building || e.hp <= 0 || (e.type !== 'unit_wl_macrophage' && e.type !== 'hero_wl_bigmac')) continue;
      const i = Math.floor(e.y / SUB) * ctx.map.w + Math.floor(e.x / SUB);
      const k = world.pus.findIndex((p) => p.i === i);
      if (k < 0) continue;
      world.pus.splice(k, 1);
      ctx.pus[i] = 0;
      e.hp = Math.min(e.maxHp, e.hp + 6);
    }
  }

  const h = world.host;
  if (!h) return;
  const before = tierOf(h.infl);
  let add = 0;
  for (const ev of events) {
    if (ev.type === 'died' && ev.entityType === 'unit_wl_neutrophil') add += INFL_NEUTROPHIL_DEATH;
    if (ev.type === 'launched') {
      if (ev.weapon === 'w_histamine') add += INFL_HISTAMINE;
      else if (ev.weapon === 'w_toxin_spit') add += INFL_TOXIN;
      else if (ev.weapon === 'w_toxin_spray') add += INFL_TOXIN_SPRAY;
    }
    if (ev.type === 'hit') h.lastFight = tick;
  }
  h.infl += add - INFL_EBB;
  if (tick - h.lastFight >= INFL_CALM_AFTER) h.infl -= INFL_CALM;
  let tregs = 0;
  for (const e of world.entities) if (e.type === 'unit_wl_treg' && e.hp > 0) tregs++;
  h.infl -= tregs * INFL_TREG;
  h.infl = Math.max(0, Math.min(INFL_MAX, h.infl));
  const tier = tierOf(h.infl);
  if (tier !== before) out.push({ type: 'host_tier', tier });

  // pressure: falls while inflammation rages, recovers when it does not
  if (h.infl >= TIER_RAGING) h.pressure = Math.max(30_000, h.pressure - 12);
  else h.pressure = Math.min(PRESSURE_START, h.pressure + 25);

  // a raging inflammation burns the tissue: 1% of it a minute, twice that with a fever above 40
  if (h.infl >= TIER_RAGING && h.tissueMax > 0) {
    // 1% a minute: tissueMax / 100 hit points over 1,200 ticks, in thousandths
    h.tissueOwed += Math.floor((h.tissueMax * (feverOf(h.infl) > 400 ? 2 : 1)) / 120);
    if (h.tissueOwed >= 1000) {
      let dmg = Math.floor(h.tissueOwed / 1000);
      h.tissueOwed -= dmg * 1000;
      // the damage falls on the host cells in id order, the healthiest first
      const cells = world.entities.filter((e) => isHostCell(ctx, e) && e.hp > 0).sort((a, b) => b.hp - a.hp || a.id - b.id);
      for (const c of cells) {
        if (dmg === 0) break;
        const d = Math.min(dmg, c.hp);
        c.hp -= d;
        dmg -= d;
      }
    }
  }

  // the two ways the patient is lost while the battle goes on
  if (h.infl >= TIER_STORM) {
    if (h.stormSince < 0) h.stormSince = tick;
    else if (tick - h.stormSince >= STORM_TICKS) out.push({ type: 'host_lost', reason: 'cytokine_storm' });
  } else h.stormSince = -1;
  if (h.pressure < PRESSURE_SHOCK) {
    if (h.shockSince < 0) h.shockSince = tick;
    else if (tick - h.shockSince >= SHOCK_TICKS) out.push({ type: 'host_lost', reason: 'shock' });
  } else h.shockSince = -1;
}

/** Production runs a quarter slower while the pressure is low: one tick in four makes no progress. */
export function productionStalls(world: World): boolean {
  return world.host !== null && world.host.pressure < PRESSURE_SLOW && world.tick % 4 === 0;
}
