// Antigen presentation (architecture tab, sections 4 and 9; main tab, section 3.3): the White
// Line learns its enemy before it can make specific cells.
//
// A dendritic cell takes a sample from an enemy it can see (unit or building): it stays next
// to it for 5 seconds. It then carries the sample to a lymph node; the sample is processed
// there for 30 seconds (one at a time), and the enemy's family opens for the player. Tier 2
// requires an opened family. A dendritic cell killed on the way loses the sample; a lymph
// node lost while processing loses what it held.
//
// Acquired units are trained against the family opened last: +50% against it, −30% against
// everything else (combat.ts, damageOf).

import type { Cmd, RejectReason } from '../commands/commands';
import { footprintOrigin, type SimContext } from '../context';
import { SUB } from '../core/fixed';
import { entityById, type Entity, type World } from '../core/world';
import { familyOf, gap } from '../combat/combat';
import { inReach } from '../economy/gather';
import { clearMove, travelTo } from '../navigation/movement';
import { allied, canSee } from '../vision/vision';

export const SAMPLE_TICKS = 100;
export const LAB_TICKS = 600;
/** Close enough to take a sample: within this of the target's body edge. */
export const SAMPLE_REACH = 128;
const CHASE_EVERY = 10;
const DELIVER_TRIES = 3;

export type AntigenEvent =
  | { type: 'sampled'; entity: number; family: string; owner: number }
  | { type: 'sample_delivered'; entity: number; lab: number; family: string; owner: number }
  | { type: 'antigen_opened'; owner: number; family: string }
  | { type: 'sample_stopped'; entity: number; owner: number; reason: 'gone' | 'no_lymph_node' | 'path_blocked' };

type Sample = Extract<Cmd, { type: 'SAMPLE' }>;

const isSampler = (ctx: SimContext, u: Entity) => ctx.catalog.units.get(u.type)?.role === 'intel' && u.morph === null && !u.building;

export function validateSample(world: World, ctx: SimContext, player: number, cmd: Sample, units: Entity[]): RejectReason | null {
  if (!units.some((u) => isSampler(ctx, u))) return 'no_dendritic';
  const t = entityById(world, cmd.target);
  if (!t || t.hp <= 0 || t.owner === 0 || allied(world, player, t.owner) || !canSee(ctx, player, t)) return 'unknown_target';
  if (familyOf(ctx, t) === '') return 'no_family';
  return null;
}

export function applySample(world: World, ctx: SimContext, cmd: Sample, units: Entity[]): void {
  for (const u of units) {
    if (!isSampler(ctx, u)) continue;
    clearMove(world, u);
    u.job = { kind: 'sample', target: cmd.target, tries: 0, next: -1, build: '', tx: 0, ty: 0, paid: [0, 0] };
    u.order = { kind: 'job' };
  }
}

/** Lymph nodes of the player that take samples: finished, standing, with a lab. */
function nearestLab(world: World, u: Entity): Entity | null {
  let best: Entity | null = null;
  let bd = 0;
  for (const b of world.entities) {
    if (!b.lab || b.owner !== u.owner || b.hp <= 0 || b.build) continue;
    const d = (b.x - u.x) ** 2 + (b.y - u.y) ** 2;
    if (!best || d < bd) {
      best = b;
      bd = d;
    }
  }
  return best;
}

function approach(world: World, ctx: SimContext, u: Entity, t: Entity): void {
  if (!t.building) {
    travelTo(world, ctx, u, t.x, t.y);
    return;
  }
  const [tx, ty, fw, fh] = footprintOrigin(ctx, t.type, t.x, t.y);
  const cx = Math.min(Math.max(u.x, tx * SUB - SUB / 2), (tx + fw) * SUB + SUB / 2);
  const cy = Math.min(Math.max(u.y, ty * SUB - SUB / 2), (ty + fh) * SUB + SUB / 2);
  travelTo(world, ctx, u, cx, cy);
}

function stop(world: World, u: Entity, reason: 'gone' | 'no_lymph_node' | 'path_blocked', events: AntigenEvent[]): void {
  u.job = null;
  u.order = { kind: 'idle' };
  clearMove(world, u);
  events.push({ type: 'sample_stopped', entity: u.id, owner: u.owner, reason });
}

/** Phase 7: samplers sample and carry; lymph nodes process. */
export function antigenPhase(world: World, ctx: SimContext, events: AntigenEvent[]): void {
  const tick = world.tick;
  for (const u of world.entities) {
    const j = u.job;
    if (!j || u.hp <= 0 || (j.kind !== 'sample' && j.kind !== 'deliver')) continue;
    if (j.kind === 'sample') {
      const t = entityById(world, j.target);
      if (!t || t.hp <= 0 || !canSee(ctx, u.owner, t)) {
        stop(world, u, 'gone', events);
        continue;
      }
      if (gap(ctx, u, t) > SAMPLE_REACH) {
        j.next = -1; // sampling starts over once it is next to it again
        if (!u.mv || (tick + u.id) % CHASE_EVERY === 0) approach(world, ctx, u, t);
        continue;
      }
      if (u.mv) clearMove(world, u);
      if (j.next < 0) j.next = tick;
      if (tick - j.next < SAMPLE_TICKS) continue;
      u.sample = familyOf(ctx, t);
      events.push({ type: 'sampled', entity: u.id, family: u.sample, owner: u.owner });
      const lab = nearestLab(world, u);
      if (!lab) {
        stop(world, u, 'no_lymph_node', events);
        continue;
      }
      u.job = { kind: 'deliver', target: lab.id, tries: 0, next: 0, build: '', tx: 0, ty: 0, paid: [0, 0] };
      approach(world, ctx, u, lab);
      continue;
    }
    // carrying a sample home
    let lab = entityById(world, j.target);
    if (!lab || lab.hp <= 0 || !lab.lab || lab.build || lab.owner !== u.owner) {
      const next = nearestLab(world, u);
      if (!next) {
        stop(world, u, 'no_lymph_node', events);
        continue;
      }
      j.target = next.id;
      j.tries = 0;
      lab = next;
      approach(world, ctx, u, lab);
    }
    if (!inReach(ctx, u, lab)) {
      if (!u.mv) {
        j.tries++;
        if (j.tries > DELIVER_TRIES) stop(world, u, 'path_blocked', events);
        else approach(world, ctx, u, lab);
      }
      continue;
    }
    if (u.mv) clearMove(world, u);
    lab.lab!.push({ family: u.sample, until: 0 });
    events.push({ type: 'sample_delivered', entity: u.id, lab: lab.id, family: u.sample, owner: u.owner });
    u.sample = '';
    u.job = null;
    u.order = { kind: 'idle' };
  }
  // processing, one sample at a time per lymph node
  for (const b of world.entities) {
    const q = b.lab;
    if (!q || q.length === 0 || b.hp <= 0 || b.build) continue;
    const front = q[0]!;
    if (front.until === 0) front.until = tick + LAB_TICKS;
    if (tick < front.until) continue;
    q.shift();
    const p = world.players[b.owner - 1]!;
    if (!p.antigens.includes(front.family)) {
      p.antigens.push(front.family);
      events.push({ type: 'antigen_opened', owner: b.owner, family: front.family });
    }
  }
}
