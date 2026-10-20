import { describe, expect, it } from 'vitest';
import { CommandQueue, MAX_UNITS_PER_COMMAND, type CommandEnvelope } from '../../src/sim/commands/commands';
import { createWorld } from '../../src/sim/core/world';
import { step } from '../../src/sim/sim';
import { newCtx, setup } from './helpers';

function fresh() {
  const ctx = newCtx();
  const world = createWorld(ctx, setup);
  const mine = world.entities.filter((e) => e.owner === 1 && !e.building).map((e) => e.id);
  const theirs = world.entities.filter((e) => e.owner === 2 && !e.building).map((e) => e.id);
  const hq = world.entities.find((e) => e.owner === 1 && e.building)!.id;
  return { ctx, world, mine, theirs, hq };
}

function rejectionOf(env: CommandEnvelope, prep?: (w: ReturnType<typeof fresh>) => void) {
  const f = fresh();
  prep?.(f);
  const res = step(f.world, f.ctx, [env]);
  const r = res.events.find((e) => e.type === 'rejected');
  return r && r.type === 'rejected' ? r.rejection.reason : null;
}

describe('command validation', () => {
  const { mine, theirs, hq } = fresh();
  const base = (cmd: CommandEnvelope['cmd'], player = 1): CommandEnvelope => ({ player, seq: 1, tick: 0, cmd });

  it('accepts a valid move', () => {
    expect(rejectionOf(base({ type: 'MOVE', units: mine, x: 1000, y: 1000 }))).toBeNull();
  });
  it('rejects ordering the other player’s units', () => {
    expect(rejectionOf(base({ type: 'MOVE', units: theirs.slice(0, 1), x: 1000, y: 1000 }))).toBe('not_owner');
  });
  it('rejects a building in a unit command', () => {
    expect(rejectionOf(base({ type: 'STOP', units: [hq] }))).toBe('not_a_unit');
  });
  it('rejects a target outside the map', () => {
    expect(rejectionOf(base({ type: 'MOVE', units: mine, x: -1, y: 10 }))).toBe('out_of_bounds');
    expect(rejectionOf(base({ type: 'MOVE', units: mine, x: 104 * 256, y: 10 }))).toBe('out_of_bounds');
  });
  it('rejects empty, duplicated, unknown and oversized unit lists', () => {
    expect(rejectionOf(base({ type: 'STOP', units: [] }))).toBe('no_units');
    expect(rejectionOf(base({ type: 'STOP', units: [mine[0]!, mine[0]!] }))).toBe('duplicate_unit');
    expect(rejectionOf(base({ type: 'STOP', units: [99999] }))).toBe('unknown_unit');
    const many = Array.from({ length: MAX_UNITS_PER_COMMAND + 1 }, (_, i) => i + 1);
    expect(rejectionOf(base({ type: 'STOP', units: many }))).toBe('too_many_units');
  });
  it('rejects unknown and defeated players', () => {
    expect(rejectionOf(base({ type: 'STOP', units: mine }, 9))).toBe('unknown_player');
    expect(rejectionOf(base({ type: 'STOP', units: mine }), (f) => { f.world.players[0]!.defeated = true; })).toBe('player_defeated');
  });
  it('a rejected command changes nothing', () => {
    const withCmd = fresh();
    const without = fresh();
    const a = step(withCmd.world, withCmd.ctx, [base({ type: 'MOVE', units: theirs, x: 1, y: 1 })]);
    const b = step(without.world, without.ctx, []);
    expect(a.hash).toBe(b.hash);
  });
});

describe('command queue', () => {
  it('rejects malformed, late and repeated commands', () => {
    const q = new CommandQueue();
    expect(q.submit({ player: 1, seq: 1, tick: 5, cmd: { type: 'FLY', units: [1] } }, 0)).toBe(false);
    expect(q.submit({ player: 1, seq: 1, tick: 5, cmd: { type: 'MOVE', units: [1], x: 1.5, y: 2 } }, 0)).toBe(false);
    expect(q.submit({ player: 1, seq: 2, tick: 3, cmd: { type: 'STOP', units: [1] } }, 4)).toBe(false);
    expect(q.submit({ player: 1, seq: 3, tick: 9, cmd: { type: 'STOP', units: [1] } }, 4)).toBe(true);
    expect(q.submit({ player: 1, seq: 3, tick: 9, cmd: { type: 'STOP', units: [1] } }, 4)).toBe(false);
    expect(q.rejected.map((r) => r.reason)).toEqual(['bad_shape', 'bad_shape', 'late', 'duplicate_seq']);
  });
  it('releases each command exactly on its tick, sorted', () => {
    const q = new CommandQueue();
    q.submit({ player: 2, seq: 1, tick: 2, cmd: { type: 'STOP', units: [1] } }, 0);
    q.submit({ player: 1, seq: 1, tick: 2, cmd: { type: 'STOP', units: [1] } }, 0);
    q.submit({ player: 1, seq: 2, tick: 1, cmd: { type: 'STOP', units: [1] } }, 0);
    expect(q.take(0)).toEqual([]);
    expect(q.take(1).map((c) => c.seq)).toEqual([2]);
    expect(q.take(2).map((c) => c.player)).toEqual([1, 2]);
    expect(q.size).toBe(0);
  });
});

describe('dev spawn', () => {
  it('works only in a dev match, and puts units on open ground', () => {
    const f = fresh();
    const cmd = { player: 1, seq: 1, tick: 0, cmd: { type: 'DEV_SPAWN' as const, units: [], unit: 'unit_wl_neutrophil', count: 9, x: 15 * 256, y: 20 * 256 } };
    const r = step(f.world, f.ctx, [cmd]);
    expect(r.events.some((e) => e.type === 'rejected' && e.rejection.reason === 'not_a_dev_match')).toBe(true);
    const ctx = newCtx();
    const world = createWorld(ctx, { ...setup, dev: true });
    const before = world.entities.length;
    step(world, ctx, [cmd]);
    expect(world.entities.length).toBe(before + 9);
    step(world, ctx, [{ ...cmd, seq: 2, tick: 1, cmd: { ...cmd.cmd, unit: 'unit_nope' } }]);
    expect(world.entities.length).toBe(before + 9);
  });
});
