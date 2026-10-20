// Runs a match without a screen: the base of every determinism test and replay check.

import { CommandQueue, type CommandEnvelope } from './commands/commands';
import type { SimContext } from './context';
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
  maxPathExpansions: number;
}

export function runHeadless(ctx: SimContext, setup: MatchSetup, opts: RunOptions): RunResult {
  const world = opts.start ?? createWorld(ctx, setup);
  const queue = opts.queue ?? new CommandQueue();
  const checkpoints: { tick: number; hash: string }[] = [];
  const events: SimEvent[] = [];
  const problems: string[] = [];
  let hash = '';
  let maxPathExpansions = 0;
  const end = world.tick + opts.ticks;
  while (world.tick < end) {
    for (const c of opts.script?.(world, world.tick) ?? []) queue.submit(c, world.tick);
    const res = step(world, ctx, queue.take(world.tick));
    if (world.tick === end || (opts.checkpointEvery && world.tick % opts.checkpointEvery === 0)) hash = res.hash;
    maxPathExpansions = Math.max(maxPathExpansions, res.stats.pathExpansions);
    events.push(...res.events);
    if (opts.invariants) for (const p of checkInvariants(world, ctx)) problems.push(`tick ${world.tick}: ${p}`);
    if (opts.checkpointEvery && world.tick % opts.checkpointEvery === 0) checkpoints.push({ tick: world.tick, hash });
  }
  for (const r of queue.rejected) events.push({ tick: world.tick, type: 'rejected', rejection: r });
  return { world, finalHash: hash, checkpoints, events, problems, queue, maxPathExpansions };
}
