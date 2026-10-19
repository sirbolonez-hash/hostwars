import { describe, expect, it } from 'vitest';
import { CommandQueue, type CommandEnvelope } from '../../src/sim/commands/commands';
import { createWorld, restore, snapshot } from '../../src/sim/core/world';
import { runHeadless } from '../../src/sim/headless';
import { step } from '../../src/sim/sim';
import { catalog, monkey, setup } from './helpers';

describe('determinism (gate 1 acceptance)', () => {
  it('1,000 ticks twice give the same hash at every checkpoint', () => {
    const a = runHeadless(catalog, setup, { ticks: 1000, script: monkey(7), checkpointEvery: 50, invariants: true });
    const b = runHeadless(catalog, setup, { ticks: 1000, script: monkey(7), checkpointEvery: 50, invariants: true });
    expect(a.problems).toEqual([]);
    expect(a.checkpoints).toHaveLength(20);
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(b.finalHash).toBe(a.finalHash);
    // the monkey really moved things
    expect(a.events.filter((e) => e.type === 'arrived').length).toBeGreaterThan(10);
  });

  it('a different seed gives a different match', () => {
    const a = runHeadless(catalog, setup, { ticks: 200, script: monkey(7) });
    const b = runHeadless(catalog, { ...setup, seed: setup.seed + 1 }, { ticks: 200, script: monkey(7) });
    expect(b.finalHash).not.toBe(a.finalHash);
  });

  it('the order in which players’ commands arrive within a tick does not matter', () => {
    const run = (reverse: boolean) => {
      const world = createWorld(catalog, setup);
      const queue = new CommandQueue();
      const units1 = world.entities.filter((e) => e.owner === 1 && !e.building).map((e) => e.id);
      const units2 = world.entities.filter((e) => e.owner === 2 && !e.building).map((e) => e.id);
      const cmds: CommandEnvelope[] = [
        { player: 2, seq: 1, tick: 0, cmd: { type: 'MOVE', units: units2, x: 5000, y: 6000 } },
        { player: 1, seq: 1, tick: 0, cmd: { type: 'MOVE', units: units1, x: 9000, y: 7000 } },
        { player: 1, seq: 2, tick: 0, cmd: { type: 'MOVE', units: units1.slice(0, 3), x: 100, y: 100 } },
      ];
      // each player's own commands always arrive in order (seq only grows); players interleave freely
      const order = reverse ? [cmds[0]!, cmds[1]!, cmds[2]!] : [cmds[1]!, cmds[2]!, cmds[0]!];
      for (const c of order) expect(queue.submit(c, 0)).toBe(true);
      let hash = '';
      for (let t = 0; t < 300; t++) hash = step(world, catalog, queue.take(world.tick)).hash;
      return { hash, world };
    };
    const a = run(false);
    const b = run(true);
    expect(b.hash).toBe(a.hash);
    // seq 2 of player 1 runs after seq 1, so those three units head for (100, 100)
    const first = a.world.entities.find((e) => e.owner === 1 && !e.building)!;
    expect([first.x, first.y]).toEqual([100, 100]);
  });

  it('save at tick 500 and continue: identical to never stopping', () => {
    const script = monkey(11);
    const full = runHeadless(catalog, setup, { ticks: 1000, script: monkey(11) });
    const half = runHeadless(catalog, setup, { ticks: 500, script });
    const saved = JSON.stringify({ world: JSON.parse(snapshot(half.world)), queue: half.queue.toJSON() });
    const loaded = JSON.parse(saved);
    const resumed = runHeadless(catalog, setup, {
      ticks: 500, script, start: restore(JSON.stringify(loaded.world)), queue: CommandQueue.fromJSON(loaded.queue),
    });
    expect(half.queue.size).toBeGreaterThanOrEqual(0);
    expect(resumed.finalHash).toBe(full.finalHash);
  });
});
