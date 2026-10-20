import { describe, expect, it } from 'vitest';
import { CommandQueue, type CommandEnvelope } from '../../src/sim/commands/commands';
import { contextForWorld } from '../../src/sim/context';
import { createWorld, restore, snapshot } from '../../src/sim/core/world';
import { runHeadless } from '../../src/sim/headless';
import { step } from '../../src/sim/sim';
import { arena, catalog, monkey, newCtx, setup } from './helpers';

describe('determinism (gate 1 acceptance, now with navigation and economy)', () => {
  it('1,000 ticks twice give the same hash at every checkpoint', () => {
    const a = runHeadless(newCtx(), setup, { ticks: 1000, script: monkey(7), checkpointEvery: 50, invariants: true });
    const b = runHeadless(newCtx(), setup, { ticks: 1000, script: monkey(7), checkpointEvery: 50, invariants: true });
    expect(a.problems).toEqual([]);
    expect(a.checkpoints).toHaveLength(20);
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(b.finalHash).toBe(a.finalHash);
    // the monkey really moved things (its gather orders mostly get interrupted; the save test below mines for real)
    expect(a.events.filter((e) => e.type === 'arrived').length).toBeGreaterThanOrEqual(3);
  });

  it('a different seed gives a different match', () => {
    const a = runHeadless(newCtx(), setup, { ticks: 200, script: monkey(7) });
    const b = runHeadless(newCtx(), { ...setup, seed: setup.seed + 1 }, { ticks: 200, script: monkey(7) });
    expect(b.finalHash).not.toBe(a.finalHash);
  });

  it('the order in which players’ commands arrive within a tick does not matter', () => {
    const run = (reverse: boolean) => {
      const ctx = newCtx();
      const world = createWorld(ctx, setup);
      const queue = new CommandQueue();
      const units1 = world.entities.filter((e) => e.owner === 1 && !e.building).map((e) => e.id);
      const units2 = world.entities.filter((e) => e.owner === 2 && !e.building).map((e) => e.id);
      const cmds: CommandEnvelope[] = [
        { player: 2, seq: 1, tick: 0, cmd: { type: 'MOVE', units: units2, x: 80 * 256, y: 30 * 256 } },
        { player: 1, seq: 1, tick: 0, cmd: { type: 'MOVE', units: units1, x: 15 * 256, y: 36 * 256 } },
        { player: 1, seq: 2, tick: 0, cmd: { type: 'MOVE', units: units1.slice(0, 3), x: 20 * 256, y: 20 * 256 } },
      ];
      // each player's own commands always arrive in order (seq only grows); players interleave freely
      const order = reverse ? [cmds[0]!, cmds[1]!, cmds[2]!] : [cmds[1]!, cmds[2]!, cmds[0]!];
      for (const c of order) expect(queue.submit(c, 0)).toBe(true);
      let hash = '';
      for (let t = 0; t < 300; t++) hash = step(world, ctx, queue.take(world.tick)).hash;
      return { hash, world };
    };
    const a = run(false);
    const b = run(true);
    expect(b.hash).toBe(a.hash);
    // seq 2 of player 1 runs after seq 1, so those three units end up near (20, 20)
    const first = a.world.entities.find((e) => e.owner === 1 && !e.building)!;
    expect(Math.abs(first.x - 20 * 256)).toBeLessThan(3 * 256);
    expect(Math.abs(first.y - 20 * 256)).toBeLessThan(3 * 256);
  });

  it('save at tick 500 and continue: identical to never stopping', () => {
    const script = monkey(11);
    const full = runHeadless(newCtx(), setup, { ticks: 1000, script: monkey(11) });
    const half = runHeadless(newCtx(), setup, { ticks: 500, script });
    const saved = JSON.stringify({ world: JSON.parse(snapshot(half.world)), queue: half.queue.toJSON() });
    const loaded = JSON.parse(saved);
    const world = restore(JSON.stringify(loaded.world));
    const resumed = runHeadless(contextForWorld(catalog, arena, world), setup, {
      ticks: 500, script, start: world, queue: CommandQueue.fromJSON(loaded.queue),
    });
    expect(resumed.finalHash).toBe(full.finalHash);
  });

  it('save mid-cycle, with slots held and loads on the way: identical to never stopping', () => {
    // both players mine from the first tick; the monkey keeps poking at them. The monkey has
    // state, so every run gets its own copy, and the save/resume pair shares one.
    const makeScript = () => {
      const poke = monkey(13, 90);
      return (world: Parameters<typeof poke>[0], tick: number): CommandEnvelope[] => {
        const pokes = poke(world, tick).map((c) => ({ ...c, seq: c.seq + 1 }));
        if (tick !== 0) return pokes;
        const gathers = [1, 2].map((player) => {
          const units = world.entities.filter((e) => e.owner === player && (catalog.units.get(e.type)?.carry ?? 0) > 0).map((e) => e.id);
          const crystal = world.entities.find((e) => e.res?.field === player)!;
          return { player, seq: 1, tick, cmd: { type: 'GATHER' as const, units, target: crystal.id } };
        });
        return [...gathers, ...pokes];
      };
    };
    const script = makeScript();
    const full = runHeadless(newCtx(), setup, { ticks: 1400, script: makeScript(), invariants: true });
    expect(full.problems).toEqual([]);
    const half = runHeadless(newCtx(), setup, { ticks: 700, script });
    const w = half.world;
    expect(w.entities.some((e) => e.cargo > 0)).toBe(true);
    expect(w.entities.some((e) => e.res?.slots.some((id) => id !== 0))).toBe(true);
    const saved = JSON.stringify({ world: JSON.parse(snapshot(w)), queue: half.queue.toJSON() });
    const loaded = JSON.parse(saved);
    const world = restore(JSON.stringify(loaded.world));
    const resumed = runHeadless(contextForWorld(catalog, arena, world), setup, {
      ticks: 700, script, start: world, queue: CommandQueue.fromJSON(loaded.queue),
    });
    expect(resumed.finalHash).toBe(full.finalHash);
    expect(world.players[0]!.basic).toBeGreaterThan(350);
  });
});
