// Runs an AI as a player of a match: builds its observation when one of its layers is due,
// asks it for commands, and sends them through the same queue as a person's, for a tick
// shortly ahead (the AI's "reaction time" is the same for everyone).

import { due, think } from '../ai/brain';
import { AI_DELAY, newAiState, type AiServices, type AiState, type Difficulty } from '../ai/types';
import { checkPlacement } from '../sim/build/placement';
import { computeBiofilm } from '../sim/colony/biofilm';
import type { CommandQueue } from '../sim/commands/commands';
import type { SimContext } from '../sim/context';
import type { World } from '../sim/core/world';
import { T_OPEN } from '../sim/navigation/grid';
import { observe } from '../sim/vision/observe';
import { canSee, computeVision } from '../sim/vision/vision';

export { AI_DELAY };

export class AiPlayer {
  constructor(public state: AiState, readonly start: [number, number]) {}

  static create(player: number, faction: string, level: Difficulty, start: [number, number]): AiPlayer {
    return new AiPlayer(newAiState(player, faction, level), start);
  }

  /** Call before each step, with the world as it is now. */
  tick(world: World, ctx: SimContext, queue: CommandQueue): void {
    const st = this.state;
    if (!due(st, world.tick)) return;
    const p = world.players[st.player - 1];
    if (!p || p.defeated || world.outcome) return;
    // what the player sees now (the same on a resumed match as on one never stopped)
    computeBiofilm(world, ctx);
    computeVision(world, ctx, false);
    const obs = observe(world, ctx, st.player, this.start);
    const svc: AiServices = {
      catalog: ctx.catalog,
      place: (type, tx, ty) => {
        const c = checkPlacement(world, ctx, st.player, type, tx, ty, (e) => canSee(ctx, st.player, e));
        return c.ok ? null : c.reason;
      },
      open: (tx, ty) => ctx.nav.inBounds(tx, ty) && ctx.nav.terrain[ty * ctx.nav.w + tx] === T_OPEN,
    };
    for (const cmd of think(st, obs, svc)) {
      st.seq++;
      queue.submit({ player: st.player, seq: st.seq, tick: world.tick + AI_DELAY, cmd }, world.tick);
    }
  }

  toJSON(): { state: AiState; start: [number, number] } {
    return { state: this.state, start: this.start };
  }

  static fromJSON(d: { state: AiState; start: [number, number] }): AiPlayer {
    return new AiPlayer(structuredClone(d.state), [d.start[0], d.start[1]]);
  }
}
