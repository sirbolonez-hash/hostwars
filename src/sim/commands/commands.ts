// Commands are the only way to change the world. Every source (player, AI, replay,
// mission trigger) sends the same envelopes through the same gate.

import { isInt } from '../core/fixed';
import type { World } from '../core/world';

export const MAX_UNITS_PER_COMMAND = 200;

export type Cmd =
  | { type: 'MOVE'; units: number[]; x: number; y: number }
  | { type: 'STOP'; units: number[] }
  | { type: 'HOLD'; units: number[] };

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
  | 'out_of_bounds';

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
      return isInt(c.x) && isInt(c.y);
    case 'STOP':
    case 'HOLD':
      return true;
    default:
      return false;
  }
}

/** Validates against the current world. Returns null when the command may run. */
export function validate(world: World, env: CommandEnvelope, index: Map<number, World['entities'][number]>): RejectReason | null {
  const p = world.players[env.player - 1];
  if (!p) return 'unknown_player';
  if (p.defeated) return 'player_defeated';
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
  if (env.cmd.type === 'MOVE') {
    const { x, y } = env.cmd;
    if (x < 0 || y < 0 || x >= world.mapW || y >= world.mapH) return 'out_of_bounds';
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
