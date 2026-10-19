import { loadCatalog } from '../../src/sim/content/load';
import type { CommandEnvelope } from '../../src/sim/commands/commands';
import { nextInt, seedRng } from '../../src/sim/core/rng';
import type { MatchSetup, World } from '../../src/sim/core/world';

export const catalog = loadCatalog();

export const setup: MatchSetup = {
  seed: 20261019,
  mapTiles: [104, 58],
  players: [
    { faction: 'wl', team: 1, startTile: [8, 24] },
    { faction: 'col', team: 2, startTile: [90, 24] },
  ],
};

/** A seeded "monkey" that orders random groups to random points, from both players. */
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
    const kind = nextInt(rng, 10);
    const cmd =
      kind < 8
        ? { type: 'MOVE' as const, units, x: nextInt(rng, world.mapW), y: nextInt(rng, world.mapH) }
        : kind === 8
          ? { type: 'STOP' as const, units }
          : { type: 'HOLD' as const, units };
    return [{ player, seq: s, tick: tick + nextInt(rng, 3), cmd }];
  };
}
