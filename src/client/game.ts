// The client's match: owns the world, the command queue and the fixed 20 Hz clock.
// Every change the player makes goes out as a command for the next tick.

import { CommandQueue, type Cmd } from '../sim/commands/commands';
import type { SimContext } from '../sim/context';
import { createWorld, type MatchSetup, type World } from '../sim/core/world';
import { step, type SimEvent } from '../sim/sim';
import { TICK_MS } from '../sim/core/fixed';

const MAX_STEPS_PER_FRAME = 5;

export class Game {
  readonly world: World;
  readonly queue = new CommandQueue();
  readonly me = 1;
  /** positions before the last tick, for interpolation */
  readonly prev = new Map<number, [number, number]>();
  private seq = 0;
  private acc = 0;
  speed = 1;
  paused = false;
  readonly simTimes: number[] = [];
  readonly pathCounts: number[] = [];
  lastEvents: SimEvent[] = [];

  constructor(readonly ctx: SimContext, setup: MatchSetup) {
    this.world = createWorld(ctx, setup);
  }

  issue(cmd: Cmd): void {
    this.queue.submit({ player: this.me, seq: ++this.seq, tick: this.world.tick + 1, cmd }, this.world.tick);
  }

  /** Advances the clock by real time; returns the interpolation fraction for drawing. */
  frame(dtMs: number): number {
    if (this.paused) return 1;
    this.acc += Math.min(dtMs, 250) * this.speed;
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.prev.clear();
      for (const e of this.world.entities) this.prev.set(e.id, [e.x, e.y]);
      const t0 = performance.now();
      const res = step(this.world, this.ctx, this.queue.take(this.world.tick));
      this.simTimes.push(performance.now() - t0);
      this.pathCounts.push(res.stats.pathExpansions);
      if (this.simTimes.length > 100) {
        this.simTimes.shift();
        this.pathCounts.shift();
      }
      this.lastEvents = res.events;
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0; // too slow to catch up: drop time rather than spiral
    return Math.min(1, this.acc / TICK_MS);
  }
}
