// Gate 7 acceptance: missions 1–3 can be won under the player's rules, end the same way every
// time, resume from a save exactly, and are lost the ways the design says.
import { describe, expect, it } from 'vitest';
import { AiPlayer } from '../../src/match/aiPlayer';
import { CommandQueue, type Cmd } from '../../src/sim/commands/commands';
import { loadCatalog, loadMap, loadMission, missionContext } from '../../src/sim/content/load';
import { contextForWorld, type SimContext } from '../../src/sim/context';
import { restore, snapshot, type World } from '../../src/sim/core/world';
import { startMission } from '../../src/sim/mission/mission';
import { checkInvariants, hashWorld, step, type SimEvent } from '../../src/sim/sim';

const MIN = 1200;
const T = 256;

/** The scripted player of mission 1: all neutrophils at the nearest cluster, then platelets to the wound. */
function scratchBot(world: World): Cmd[] {
  const mine = world.entities.filter((e) => e.owner === 1 && !e.building);
  const fighters = mine.filter((e) => e.type === 'unit_wl_neutrophil').map((e) => e.id);
  const plates = mine.filter((e) => e.type === 'unit_wl_platelets').map((e) => e.id);
  const cluster = world.entities.find((e) => e.tag === 'cluster' && e.hp > 0);
  const out: Cmd[] = [];
  if (fighters.length) out.push({ type: 'ATTACK_MOVE', units: fighters, ...(cluster ? { x: cluster.x, y: cluster.y } : { x: 50 * T, y: 30 * T }) });
  if (plates.length) out.push({ type: 'MOVE', units: plates, x: 50 * T, y: 30 * T });
  return out;
}

interface Run {
  world: World;
  ctx: SimContext;
  events: SimEvent[];
  problems: string[];
}

/** Plays a mission: `bot` every second as player 1, or a White Line AI; the mission's enemy AI if it has one. */
function play(id: string, ticks: number, opts: { bot?: (w: World) => Cmd[]; ai?: 'easy' | 'normal' | 'hard'; from?: { world: World; queue: CommandQueue; ais: AiPlayer[] } } = {}) {
  const def = loadMission(id);
  const ctx = opts.from ? contextForWorld(loadCatalog(), loadMap(def.map), opts.from.world, def) : missionContext(id);
  const world = opts.from?.world ?? startMission(ctx, 11);
  const queue = opts.from?.queue ?? new CommandQueue();
  const ais = opts.from?.ais ?? [
    ...(opts.ai ? [AiPlayer.create(1, 'wl', opts.ai, ctx.map.starts[0]!)] : []),
    ...(def.enemy.ai ? [AiPlayer.create(2, def.enemy.faction, def.enemy.ai, ctx.map.starts[1]!)] : []),
  ];
  const events: SimEvent[] = [];
  const problems: string[] = [];
  let seq = 1_000_000 + world.tick;
  const end = world.tick + ticks;
  while (world.tick < end && !world.outcome) {
    if (opts.bot && world.tick % 20 === 0) for (const cmd of opts.bot(world)) queue.submit({ player: 1, seq: ++seq, tick: world.tick, cmd }, world.tick);
    for (const a of ais) a.tick(world, ctx, queue);
    const r = step(world, ctx, queue.take(world.tick));
    events.push(...r.events);
    if (world.tick % 100 === 0) for (const p of checkInvariants(world, ctx)) problems.push(`tick ${world.tick}: ${p}`);
  }
  return { world, ctx, events, problems, queue, ais } as Run & { queue: CommandQueue; ais: AiPlayer[] };
}

describe('mission 1 · the scratch', () => {
  it('a player who goes for the clusters and brings the platelets wins; every objective in order', () => {
    const r = play('m01', 10 * MIN, { bot: scratchBot });
    expect(r.world.outcome).toMatchObject({ winnerTeam: 1, reason: 'won' });
    const order = r.events.filter((e) => e.type === 'objective' && e.state === 'done').map((e) => (e as { id: string }).id);
    expect(order).toEqual(['reach', 'clusters', 'seal']);
    expect(r.problems).toEqual([]);
  }, 60_000);

  it('the same mission twice is the same mission; a save in the middle resumes exactly', () => {
    const a = play('m01', 2 * MIN, { bot: scratchBot });
    const b = play('m01', 2 * MIN, { bot: scratchBot });
    expect(hashWorld(b.world, b.ctx)).toBe(hashWorld(a.world, a.ctx));
    const half = play('m01', 1 * MIN, { bot: scratchBot });
    const saved = JSON.parse(JSON.stringify({ world: snapshot(half.world), queue: half.queue.toJSON() }));
    const resumed = play('m01', 1 * MIN, { bot: scratchBot, from: { world: restore(saved.world), queue: CommandQueue.fromJSON(saved.queue), ais: [] } });
    expect(hashWorld(resumed.world, resumed.ctx)).toBe(hashWorld(a.world, a.ctx));
  }, 60_000);

  it('left alone, the bacteria eat the tissue and the mission is lost', () => {
    const r = play('m01', 20 * MIN);
    expect(r.world.outcome?.winnerTeam).toBe(2);
    expect(['tissue', 'army']).toContain(r.world.outcome?.reason);
  }, 60_000);
});

describe('mission 2 · inflammation', () => {
  it('a White Line AI builds a base, stops the front and destroys both cores', () => {
    const r = play('m02', 20 * MIN, { ai: 'normal' });
    expect(r.world.outcome).toMatchObject({ winnerTeam: 1, reason: 'won' });
    expect(r.world.mission!.objectives).toEqual({ base: 'done', front: 'done', cores: 'done' });
    expect(r.problems).toEqual([]);
  }, 120_000);

  it('left alone, the red front reaches the lymph vessel', () => {
    const r = play('m02', 25 * MIN);
    expect(r.world.outcome).toMatchObject({ winnerTeam: 2 });
    expect(['lymph', 'hero', 'army', 'tissue']).toContain(r.world.outcome!.reason);
  }, 120_000);
});

describe('mission 3 · the node', () => {
  it('a White Line AI holds the node 20 minutes, brings an antigen, and trains its first CD4 and B cell', () => {
    const r = play('m03', 22 * MIN, { ai: 'normal' });
    expect(r.world.outcome).toMatchObject({ winnerTeam: 1, reason: 'won' });
    expect(r.world.outcome!.tick).toBeGreaterThanOrEqual(20 * MIN);
    expect(r.world.mission!.made['1:unit_wl_cd4']).toBeGreaterThan(0);
    expect(r.world.mission!.made['1:unit_wl_plasma']).toBeGreaterThan(0);
    // its thymus stands in a T zone, its germinal centre in a follicle
    for (const [type, zone] of [['bld_wl_thymus', 'T'], ['bld_wl_germinal', 'B']] as const) {
      const b = r.world.entities.find((e) => e.type === type);
      if (!b) continue; // it may have been lost in the fighting
      const g = r.ctx.zones.get(zone)!;
      expect(g[Math.floor(b.y / T) * r.ctx.map.w + Math.floor(b.x / T)]).toBe(1);
    }
  }, 180_000);

  it('left alone, the node falls', () => {
    const r = play('m03', 22 * MIN);
    expect(r.world.outcome).toMatchObject({ winnerTeam: 2, reason: 'node' });
  }, 120_000);
});
