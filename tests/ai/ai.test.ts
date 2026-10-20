// Gate 6: the AI. It plays by the player's rules (the same commands, prices and fog), ends
// matches, beats a passive player, loses to a stronger one, recovers from losses or gives up
// with a reason, never reads what it cannot see, and resumes from a save exactly.
import { describe, expect, it } from 'vitest';
import { AiPlayer } from '../../src/match/aiPlayer';
import type { Difficulty } from '../../src/ai/types';
import { CommandQueue, type CommandEnvelope } from '../../src/sim/commands/commands';
import { contextForWorld } from '../../src/sim/context';
import { createWorld, restore, snapshot, type World } from '../../src/sim/core/world';
import { runHeadless } from '../../src/sim/headless';
import type { SimEvent } from '../../src/sim/sim';
import { arena, catalog, newCtx, setup } from '../sim/helpers';

const MIN = 20 * 60;
const T = 256;

function ai(player: 1 | 2, level: Difficulty): AiPlayer {
  return AiPlayer.create(player, player === 1 ? 'wl' : 'col', level, arena.starts[player - 1]!);
}

/** A match of AIs (a missing side does nothing), until it is over or `minutes` pass. */
function play(players: AiPlayer[], minutes: number, dev = false) {
  return runHeadless(newCtx(), { ...setup, dev }, { ticks: minutes * MIN, players, untilOver: true });
}

const own = (w: World, p: number) => w.entities.filter((e) => e.owner === p);
const role = (type: string) => catalog.units.get(type)?.role;
const workers = (w: World, p: number) => own(w, p).filter((e) => role(e.type) === 'worker').length;
const of = <K extends SimEvent['type']>(evs: SimEvent[], type: K) => evs.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

/** Runs a match tick by tick, letting the test poke the world (as the dev tools would) on the way. */
function stepped(players: AiPlayer[], ticks: number, poke: (world: World, tick: number) => CommandEnvelope[] | void) {
  const ctx = newCtx();
  const world = createWorld(ctx, { ...setup, dev: true });
  const queue = new CommandQueue();
  const events: SimEvent[] = [];
  let seq = 1_000_000; // the test's own commands (as player 1 in a dev match) never clash with an AI's
  for (let t = 0; t < ticks && !world.outcome; t++) {
    const extra = poke(world, world.tick) ?? [];
    for (const c of extra) queue.submit({ ...c, seq: ++seq }, world.tick);
    const r = runHeadless(ctx, setup, { ticks: 1, players, start: world, queue });
    events.push(...r.events);
  }
  return { world, events, ctx };
}

describe('AI matches (gate 6)', () => {
  it('AI against AI ends with a winner, and the same match twice is the same match', () => {
    const a = play([ai(1, 'hard'), ai(2, 'easy')], 20);
    const b = play([ai(1, 'hard'), ai(2, 'easy')], 20);
    expect(a.world.outcome?.winnerTeam).toBe(1);
    expect(b.world.outcome).toEqual(a.world.outcome);
    expect(b.finalHash).toBe(a.finalHash);
  }, 120_000);

  it('a stronger AI beats a weaker one, playing either faction', () => {
    const r = play([ai(1, 'easy'), ai(2, 'hard')], 20);
    expect(r.world.outcome?.winnerTeam).toBe(2);
  }, 120_000);

  for (const [player, level] of [[1, 'normal'], [2, 'normal'], [2, 'easy']] as const) {
    it(`the ${player === 1 ? 'White Line' : 'Colony'} AI (${level}) beats a player who does nothing`, () => {
      const r = play([ai(player, level)], 16);
      expect(r.world.outcome?.winnerTeam).toBe(player);
      // no command of the AI's was refused for a reason it could have known
      const refused = of(r.events, 'rejected').filter((e) => e.rejection.player === player && !['depleted', 'site_blocked', 'not_ready'].includes(e.rejection.reason));
      expect(refused.map((e) => e.rejection.reason)).toEqual([]);
    }, 120_000);
  }

  it('sides swapped: a White Line AI in the east beats a Colony in the west that does nothing', () => {
    const swapped = { ...setup, players: [{ ...setup.players[0]!, faction: 'col' as const }, { ...setup.players[1]!, faction: 'wl' as const }] };
    const wl = AiPlayer.create(2, 'wl', 'normal', arena.starts[1]!);
    const r = runHeadless(newCtx(), swapped, { ticks: 18 * MIN, players: [wl], untilOver: true });
    expect(r.world.outcome?.winnerTeam).toBe(2);
    // it built its extractor on the protein deposit on its own side
    expect(own(r.world, 2).some((e) => e.type === 'bld_wl_aminopump')).toBe(true);
  }, 120_000);

  it('save and resume in the middle of a match: the AI goes on exactly as if never stopped', () => {
    const players = () => [ai(1, 'normal'), ai(2, 'hard')];
    const full = runHeadless(newCtx(), setup, { ticks: 5000, players: players() });
    const p = players();
    const half = runHeadless(newCtx(), setup, { ticks: 3000, players: p });
    const saved = JSON.stringify({ world: snapshot(half.world), queue: half.queue.toJSON(), ais: p.map((x) => x.toJSON()) });
    const data = JSON.parse(saved);
    const world = restore(data.world);
    const resumed = runHeadless(contextForWorld(catalog, arena, world), setup, {
      ticks: 2000, start: world, queue: CommandQueue.fromJSON(data.queue), players: data.ais.map(AiPlayer.fromJSON),
    });
    expect(resumed.finalHash).toBe(full.finalHash);
  }, 120_000);

  it('never reads what it cannot see: a hidden change on the far side changes none of its commands', () => {
    // both runs put the same units in a far corner, in different places: same ids, different worlds
    const record = (corner: number) => {
      const sent: string[] = [];
      const colony = ai(2, 'normal');
      const q = new CommandQueue();
      const orig = q.submit.bind(q);
      q.submit = (env: unknown, tick: number) => {
        const e = env as CommandEnvelope;
        if (e.player === 2) sent.push(JSON.stringify(e));
        return orig(env, tick);
      };
      const ctx = newCtx();
      const world = createWorld(ctx, { ...setup, dev: true });
      q.submit({ player: 1, seq: 1, tick: 0, cmd: { type: 'DEV_SPAWN', units: [], unit: 'unit_wl_neutrophil', count: 6, x: corner * T, y: 54 * T } }, 0);
      runHeadless(ctx, setup, { ticks: 40 * 20, players: [colony], start: world, queue: q });
      return sent;
    };
    const a = record(3);
    expect(a.length).toBeGreaterThan(20);
    expect(record(7)).toEqual(a);
  }, 60_000);
});

describe('AI recovery (gate 6)', () => {
  it('losing every worker: it trains new ones and the money flows again', () => {
    const colony = ai(2, 'normal');
    let killedAt = -1;
    const r = stepped([colony], 6 * MIN, (world, tick) => {
      if (tick !== 3 * MIN) return;
      killedAt = tick;
      return [{ player: 1, seq: 0, tick, cmd: { type: 'DEV_KILL', units: [], targets: own(world, 2).filter((e) => role(e.type) === 'worker').map((e) => e.id) } }];
    });
    expect(killedAt).toBe(3 * MIN);
    expect(workers(r.world, 2)).toBeGreaterThanOrEqual(6);
    const after = of(r.events, 'delivered').filter((e) => e.owner === 2 && e.tick > 4 * MIN);
    expect(after.length).toBeGreaterThan(10);
  }, 120_000);

  it('losing its core (the dropoff): the Colony builds a new one and goes back to work', () => {
    const colony = ai(2, 'normal');
    let core = 0;
    const r = stepped([colony], 8 * MIN, (world, tick) => {
      if (tick !== 4 * MIN) return;
      const c = own(world, 2).find((e) => e.type === 'bld_col_biofilm_core')!;
      core = c.id;
      world.players[1]!.basic += 400; // enough for a new core, whatever it had just spent
      return [{ player: 1, seq: 0, tick, cmd: { type: 'DEV_KILL', units: [], targets: own(world, 2).filter((e) => e.type === 'bld_col_biofilm_core').map((e) => e.id) } }];
    });
    expect(core).not.toBe(0);
    expect(r.world.players[1]!.defeated).toBe(false);
    const cores = own(r.world, 2).filter((e) => e.type === 'bld_col_biofilm_core');
    expect(cores.length).toBeGreaterThanOrEqual(1);
    const after = of(r.events, 'delivered').filter((e) => e.owner === 2 && e.tick > 5 * MIN);
    expect(after.length).toBeGreaterThan(20);
  }, 120_000);

  it('losing its lymph node, army and money: the White Line gives up, and says why', () => {
    const wl = ai(1, 'normal');
    const r = stepped([wl], 8 * MIN, (world, tick) => {
      if (tick !== 4 * MIN) return;
      world.players[0]!.basic = 0;
      world.players[0]!.advanced = 0;
      const doomed = own(world, 1).filter((e) => e.type === 'bld_wl_lymphnode' || (!e.building && role(e.type) !== 'worker') || (e.building && catalog.buildings.get(e.type)?.dropoff));
      return [{ player: 2, seq: 0, tick, cmd: { type: 'DEV_KILL', units: [], targets: doomed.map((e) => e.id) } }];
    });
    const gave = of(r.events, 'surrendered');
    expect(gave.length).toBe(1);
    expect(gave[0]!.player).toBe(1);
    expect(gave[0]!.reason).toBe('no_economy');
    expect(r.world.outcome?.winnerTeam).toBe(2);
  }, 120_000);

  it('an expansion site that keeps getting blocked: it gives the field up and its economy does not stall', () => {
    const colony = ai(2, 'normal');
    const blocked = new Set<string>();
    let maxBank = 0;
    const r = stepped([colony], 12 * MIN, (world, tick) => {
      // the other side's base stands whatever happens, so the match lasts long enough
      for (const e of own(world, 1)) if (e.building) e.hp = e.maxHp;
      if (tick > 6 * MIN) maxBank = Math.max(maxBank, world.players[1]!.basic);
      const x = colony.state.expand;
      if (!x) return;
      const key = `${x.tx},${x.ty}`;
      if (blocked.has(key)) return;
      blocked.add(key);
      // someone else's building appears on the chosen site (where no unit stands in the way of it)
      const units = world.entities.filter((e) => !e.building);
      for (let dy = 0; dy <= 2; dy++) {
        for (let dx = 0; dx <= 2; dx++) {
          const [ox, oy] = [x.tx + dx, x.ty + dy];
          const near = units.some((u) => Math.floor(u.x / T) >= ox - 1 && Math.floor(u.x / T) <= ox + 2 && Math.floor(u.y / T) >= oy - 1 && Math.floor(u.y / T) <= oy + 2);
          if (!near) return [{ player: 1, seq: 0, tick, cmd: { type: 'DEV_SPAWN', units: [], unit: 'bld_wl_capillary', count: 1, x: ox * T + 128, y: oy * T + 128 } }];
        }
      }
      return;
    });
    expect(blocked.size).toBeGreaterThanOrEqual(1);
    expect(colony.state.badFields.length).toBeGreaterThanOrEqual(1);
    expect(maxBank).toBeLessThan(1500); // the money it saved for the expansion went to other things
    expect(own(r.world, 2).filter((e) => !e.building && role(e.type) !== 'worker').length).toBeGreaterThan(10);
  }, 180_000);
});
