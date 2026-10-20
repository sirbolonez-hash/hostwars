import { loadCatalog, loadMap, newMatchContext } from '../../src/sim/content/load';
import type { MapDef } from '../../src/sim/content/types';
import type { CommandEnvelope } from '../../src/sim/commands/commands';
import { createContext, type SimContext } from '../../src/sim/context';
import { nextInt, seedRng } from '../../src/sim/core/rng';
import { createWorld, type MatchSetup, type World } from '../../src/sim/core/world';

export const catalog = loadCatalog();
export const arena = loadMap('arena');

/** A fresh context per match: the nav grid carries that match's building footprints. */
export function newCtx(): SimContext {
  return newMatchContext('arena', catalog);
}

export const setup: MatchSetup = {
  seed: 20261019,
  map: 'arena',
  players: [
    { faction: 'wl', team: 1, startTile: arena.starts[0]! },
    { faction: 'col', team: 2, startTile: arena.starts[1]! },
  ],
};

/** Builds a test map from ASCII rows ('.' open, '#' wall, '~' blood) with two corner starts. */
export function asciiMap(id: string, rows: string[], flows: MapDef['flows'] = [], resources: MapDef['resources'] = []): MapDef {
  const h = rows.length;
  const w = rows[0]!.length;
  const fields = [...new Set(resources.map((r) => r.field).filter((f) => f !== 0))].map((f) => ({ id: f, name: `field ${f}` }));
  return { id, name: id, w, h, ground: 'tile_tissue', legend: { '.': 'open', '#': 'wall', '~': 'blood' }, rows, flows, starts: [[1, 1], [w - 7, 1]], resources, fields };
}

export function matchOn(map: MapDef, seed = 1): { ctx: SimContext; world: World } {
  const ctx = createContext(catalog, map);
  const world = createWorld(ctx, {
    seed,
    map: map.id,
    players: [
      { faction: 'wl', team: 1, startTile: map.starts[0]! },
      { faction: 'col', team: 2, startTile: map.starts[1]! },
    ],
  });
  return { ctx, world };
}

/** A seeded "monkey" that orders random groups to random points and random resources, from both players. */
export function monkey(seed: number, rate = 8): (world: World, tick: number) => CommandEnvelope[] {
  const rng = seedRng(seed);
  const seq = new Map<number, number>();
  return (world, tick) => {
    if (nextInt(rng, rate) !== 0) return [];
    const player = 1 + nextInt(rng, world.players.length);
    const mine = world.entities.filter((e) => e.owner === player && !e.building).map((e) => e.id);
    if (mine.length === 0) return [];
    const n = 1 + nextInt(rng, Math.min(mine.length, 12));
    const start = nextInt(rng, mine.length);
    const units = Array.from({ length: n }, (_, k) => mine[(start + k) % mine.length]!).filter((v, i, a) => a.indexOf(v) === i);
    const s = (seq.get(player) ?? 0) + 1;
    seq.set(player, s);
    const kind = nextInt(rng, 12);
    // gather targets: any crystal, or the player's own buildings (dropoffs return cargo; others get rejected)
    const targets = world.entities.filter((e) => e.building && (e.owner === 0 || e.owner === player)).map((e) => e.id);
    const cmd =
      kind < 7
        ? { type: 'MOVE' as const, units, x: nextInt(rng, world.mapW), y: nextInt(rng, world.mapH) }
        : kind < 10
          ? { type: 'GATHER' as const, units, target: targets[nextInt(rng, targets.length)]! }
          : kind === 10
            ? { type: 'STOP' as const, units }
            : { type: 'HOLD' as const, units };
    return [{ player, seq: s, tick: tick + nextInt(rng, 3), cmd }];
  };
}
