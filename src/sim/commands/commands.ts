// Commands are the only way to change the world. Every source (player, AI, replay,
// mission trigger) sends the same envelopes through the same gate.

import type { SimContext } from '../context';
import { isInt } from '../core/fixed';
import type { World } from '../core/world';
import { validateBuildingCmd, validateUnitJob } from '../build/production';
import { validateAttack } from '../combat/combat';
import { validateGather } from '../economy/gather';

export const MAX_UNITS_PER_COMMAND = 200;

export type Cmd =
  | { type: 'MOVE'; units: number[]; x: number; y: number }
  /** armed units attack this target (an enemy the player can see) */
  | { type: 'ATTACK'; units: number[]; target: number }
  /** move there, fighting whatever comes in sight on the way */
  | { type: 'ATTACK_MOVE'; units: number[]; x: number; y: number }
  | { type: 'STOP'; units: number[] }
  | { type: 'HOLD'; units: number[] }
  /** carriers work `target` (crystal, deposit with an extractor, extractor), or return their load to it (own dropoff) */
  | { type: 'GATHER'; units: number[]; target: number }
  /** builders help a growing building grow / repair a damaged one */
  | { type: 'ASSIST_BUILD'; units: number[]; target: number }
  | { type: 'REPAIR'; units: number[]; target: number }
  /** units that can turn into another (monocyte → macrophage) start turning */
  | { type: 'DEPLOY'; units: number[] }
  // building commands: `units` is empty, `building` names the building
  | { type: 'TRAIN'; units: number[]; building: number; unit: string; count: number }
  /** cancel a queued unit (index; -1 = the last), the growing building itself, or a lymph node's unplaced order */
  | { type: 'CANCEL'; units: number[]; building: number; what: 'queue' | 'build' | 'order'; index: number }
  /** a lymph node orders (and pays for) a building, to be placed */
  | { type: 'QUEUE_BUILD'; units: number[]; building: number; build: string }
  /** places the ordered building with its top-left tile at (tx, ty) */
  | { type: 'PLACE_BUILD'; units: number[]; building: number; tx: number; ty: number }
  /** where new units go: a point, or an entity (a crystal for carriers, a unit to join) */
  | { type: 'SET_RALLY'; units: number[]; building: number; x: number; y: number; target: number }
  /**
   * test matches only: puts `count` units of `unit` around (x, y), ignoring cost and supply;
   * a building id places one building with its centre on that tile (an extractor: on the deposit there)
   */
  | { type: 'DEV_SPAWN'; units: number[]; unit: string; count: number; x: number; y: number }
  /** test matches only: destroys the listed entities at the end of the tick (any owner, resources too) */
  | { type: 'DEV_KILL'; units: number[]; targets: number[] }
  /** test matches only: adds resources */
  | { type: 'DEV_GRANT'; units: number[]; basic: number; advanced: number };

const BUILDING_CMDS = new Set(['TRAIN', 'CANCEL', 'QUEUE_BUILD', 'PLACE_BUILD', 'SET_RALLY']);

export const MAX_DEV_SPAWN = 100;

export interface CommandEnvelope {
  player: number;
  seq: number; // per player, strictly increasing
  tick: number; // tick on which it executes
  cmd: Cmd;
}

export type RejectReason =
  | 'bad_shape'
  | 'late'
  | 'duplicate_seq'
  | 'unknown_player'
  | 'player_defeated'
  | 'no_units'
  | 'too_many_units'
  | 'duplicate_unit'
  | 'not_owner'
  | 'not_a_unit'
  | 'unknown_unit'
  | 'out_of_bounds'
  | 'not_a_dev_match'
  | 'unknown_type'
  | 'bad_count'
  | 'unknown_target'
  | 'bad_target'
  | 'no_extractor'
  | 'depleted'
  | 'no_carriers'
  | 'site_blocked'
  | 'not_a_building'
  | 'not_ready'
  | 'cannot_produce'
  | 'queue_full'
  | 'requirements'
  | 'no_resources'
  | 'supply_capped'
  | 'nothing_to_cancel'
  | 'no_order'
  | 'bad_ground'
  | 'too_far'
  | 'no_builder'
  | 'no_builders'
  | 'blocks_exit'
  | 'no_deposit'
  | 'cannot_place'
  | 'nothing_to_do'
  | 'cannot_deploy'
  | 'no_weapons';

export interface Rejection {
  player: number;
  seq: number;
  reason: RejectReason;
}

/** Deterministic execution order: tick, then player, then that player's sequence number. */
export function compareEnvelopes(a: CommandEnvelope, b: CommandEnvelope): number {
  return a.tick - b.tick || a.player - b.player || a.seq - b.seq;
}

/** Shape check for envelopes that come from outside (replay files, network, scripts). */
export function checkShape(env: unknown): env is CommandEnvelope {
  if (typeof env !== 'object' || env === null) return false;
  const e = env as Record<string, unknown>;
  if (!isInt(e.player) || !isInt(e.seq) || !isInt(e.tick)) return false;
  const c = e.cmd as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return false;
  if (!Array.isArray(c.units) || !c.units.every(isInt)) return false;
  switch (c.type) {
    case 'MOVE':
    case 'ATTACK_MOVE':
      return isInt(c.x) && isInt(c.y);
    case 'ATTACK':
      return isInt(c.target);
    case 'STOP':
    case 'HOLD':
      return true;
    case 'GATHER':
    case 'ASSIST_BUILD':
    case 'REPAIR':
      return isInt(c.target);
    case 'DEPLOY':
      return true;
    case 'TRAIN':
      return isInt(c.building) && typeof c.unit === 'string' && isInt(c.count) && (c.units as unknown[]).length === 0;
    case 'CANCEL':
      return isInt(c.building) && isInt(c.index) && (c.what === 'queue' || c.what === 'build' || c.what === 'order') && (c.units as unknown[]).length === 0;
    case 'QUEUE_BUILD':
      return isInt(c.building) && typeof c.build === 'string' && (c.units as unknown[]).length === 0;
    case 'PLACE_BUILD':
      return isInt(c.building) && isInt(c.tx) && isInt(c.ty) && (c.units as unknown[]).length === 0;
    case 'SET_RALLY':
      return isInt(c.building) && isInt(c.x) && isInt(c.y) && isInt(c.target) && (c.units as unknown[]).length === 0;
    case 'DEV_GRANT':
      return isInt(c.basic) && isInt(c.advanced) && c.basic >= 0 && c.advanced >= 0 && (c.units as unknown[]).length === 0;
    case 'DEV_SPAWN':
      return typeof c.unit === 'string' && isInt(c.count) && isInt(c.x) && isInt(c.y) && (c.units as unknown[]).length === 0;
    case 'DEV_KILL':
      return Array.isArray(c.targets) && c.targets.every(isInt) && (c.units as unknown[]).length === 0;
    default:
      return false;
  }
}

/** Validates against the current world. Returns null when the command may run. */
export function validate(world: World, env: CommandEnvelope, index: Map<number, World['entities'][number]>, ctx: SimContext): RejectReason | null {
  const p = world.players[env.player - 1];
  if (!p) return 'unknown_player';
  if (p.defeated) return 'player_defeated';
  if (env.cmd.type === 'DEV_SPAWN') {
    if (!world.dev) return 'not_a_dev_match';
    const isUnit = ctx.catalog.units.has(env.cmd.unit);
    if (!isUnit && !ctx.catalog.buildings.has(env.cmd.unit)) return 'unknown_type';
    if (env.cmd.count < 1 || env.cmd.count > (isUnit ? MAX_DEV_SPAWN : 1)) return 'bad_count';
    if (env.cmd.x < 0 || env.cmd.y < 0 || env.cmd.x >= world.mapW || env.cmd.y >= world.mapH) return 'out_of_bounds';
    return null;
  }
  if (env.cmd.type === 'DEV_GRANT') return world.dev ? null : 'not_a_dev_match';
  if (BUILDING_CMDS.has(env.cmd.type)) return validateBuildingCmd(world, ctx, env.player, env.cmd as Parameters<typeof validateBuildingCmd>[3]);
  if (env.cmd.type === 'DEV_KILL') {
    if (!world.dev) return 'not_a_dev_match';
    if (env.cmd.targets.length === 0) return 'no_units';
    if (env.cmd.targets.length > MAX_UNITS_PER_COMMAND) return 'too_many_units';
    for (const id of env.cmd.targets) if (!index.has(id) && id >= world.nextId) return 'unknown_unit';
    return null;
  }
  const units = env.cmd.units;
  if (units.length === 0) return 'no_units';
  if (units.length > MAX_UNITS_PER_COMMAND) return 'too_many_units';
  const seen = new Set<number>();
  for (const id of units) {
    if (seen.has(id)) return 'duplicate_unit';
    seen.add(id);
    const e = index.get(id);
    // a unit that died before this tick is dropped quietly; an id that never existed is an error
    if (!e && id >= world.nextId) return 'unknown_unit';
    if (e && e.owner !== env.player) return 'not_owner';
    if (e && e.building) return 'not_a_unit';
  }
  if (env.cmd.type === 'MOVE' || env.cmd.type === 'ATTACK_MOVE') {
    const { x, y } = env.cmd;
    if (x < 0 || y < 0 || x >= world.mapW || y >= world.mapH) return 'out_of_bounds';
  }
  if (env.cmd.type === 'GATHER') {
    const carriers = units.map((id) => index.get(id)).filter((e) => e !== undefined && (ctx.catalog.units.get(e.type)?.carry ?? 0) > 0);
    if (carriers.length === 0) return 'no_carriers';
    return validateGather(world, ctx, env.player, index.get(env.cmd.target));
  }
  if (env.cmd.type === 'ATTACK') {
    const live = units.map((id) => index.get(id)).filter((e): e is World['entities'][number] => e !== undefined);
    return validateAttack(world, ctx, env.player, live, index.get(env.cmd.target));
  }
  if (env.cmd.type === 'ASSIST_BUILD' || env.cmd.type === 'REPAIR' || env.cmd.type === 'DEPLOY') {
    const live = units.map((id) => index.get(id)).filter((e): e is World['entities'][number] => e !== undefined);
    return validateUnitJob(world, ctx, env.player, env.cmd, live);
  }
  return null;
}

/** Holds commands until their tick; keeps the per-player sequence rule. */
export class CommandQueue {
  private pending: CommandEnvelope[] = [];
  private lastSeq = new Map<number, number>();
  readonly rejected: Rejection[] = [];

  submit(env: unknown, currentTick: number): boolean {
    if (!checkShape(env)) {
      const e = env as Partial<CommandEnvelope> | null;
      this.rejected.push({ player: Number(e?.player ?? -1), seq: Number(e?.seq ?? -1), reason: 'bad_shape' });
      return false;
    }
    if (env.tick < currentTick) {
      this.rejected.push({ player: env.player, seq: env.seq, reason: 'late' });
      return false;
    }
    const last = this.lastSeq.get(env.player) ?? -1;
    if (env.seq <= last) {
      this.rejected.push({ player: env.player, seq: env.seq, reason: 'duplicate_seq' });
      return false;
    }
    this.lastSeq.set(env.player, env.seq);
    this.pending.push(env);
    return true;
  }

  /** Removes and returns the commands for `tick`, in execution order. */
  take(tick: number): CommandEnvelope[] {
    const now = this.pending.filter((c) => c.tick === tick).sort(compareEnvelopes);
    if (now.length) this.pending = this.pending.filter((c) => c.tick !== tick);
    return now;
  }

  get size(): number {
    return this.pending.length;
  }

  /** Pending commands and sequence numbers are part of a save: without them a resumed match diverges. */
  toJSON(): { pending: CommandEnvelope[]; lastSeq: [number, number][] } {
    return { pending: [...this.pending].sort(compareEnvelopes), lastSeq: [...this.lastSeq.entries()].sort((a, b) => a[0] - b[0]) };
  }

  static fromJSON(data: { pending: CommandEnvelope[]; lastSeq: [number, number][] }): CommandQueue {
    const q = new CommandQueue();
    q.pending = data.pending.filter(checkShape);
    q.lastSeq = new Map(data.lastSeq);
    return q;
  }
}
