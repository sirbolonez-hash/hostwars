// Runs a match without a screen: the base of every determinism test and replay check.

import type { Catalog } from './content/catalog';
import { CommandQueue, type CommandEnvelope } from './commands/commands';
import { createWorld, type MatchSetup, type World } from './core/world';
import { checkInvariants, step, type SimEvent } from './sim';

export interface RunOptions {
  ticks: number;
  /** called before each tick; returns commands to submit (scheduled for this or a later tick) */
  script?: (world: World, tick: number) => CommandEnvelope[];
  checkpointEvery?: number;
  invariants?: boolean;
  start?: World;
  queue?: CommandQueue;
}

export interface RunResult {
  world: World;
  finalHash: string;
  checkpoints: { tick: number; hash: string }[];
  events: SimEvent[];
  problems: string[];
  queue: CommandQueue;
}

export function runHeadless(catalog: Catalog, setup: MatchSetup, opts: RunOptions): RunResult {
  const world = opts.start ?? createWorld(catalog, setup);
  const queue = opts.queue ?? new CommandQueue();
  const checkpoints: { tick: number; hash: string }[] = [];
  const events: SimEvent[] = [];
  const problems: string[] = [];
  let hash = '';
  const end = world.tick + opts.ticks;
  while (world.tick < end) {
    for (const c of opts.script?.(world, world.tick) ?? []) queue.submit(c, world.tick);
    const res = step(world, catalog, queue.take(world.tick));
    hash = res.hash;
    events.push(...res.events);
    if (opts.invariants) for (const p of checkInvariants(world, catalog)) problems.push(`tick ${world.tick}: ${p}`);
    if (opts.checkpointEvery && world.tick % opts.checkpointEvery === 0) checkpoints.push({ tick: world.tick, hash });
  }
  for (const r of queue.rejected) events.push({ tick: world.tick, type: 'rejected', rejection: r });
  return { world, finalHash: hash, checkpoints, events, problems, queue };
}
