import { describe, expect, it } from 'vitest';
import { createWorld, spawnUnit } from '../../src/sim/core/world';
import { checkInvariants, step } from '../../src/sim/sim';
import { catalog, setup } from './helpers';

describe('lifespan', () => {
  it('a neutrophil dies after 180 s (3,600 ticks) and gives its supply back', () => {
    const world = createWorld(catalog, setup);
    const before = world.players[0]!.supplyUsed;
    const n = spawnUnit(world, catalog, 'unit_wl_neutrophil', 1, 3000, 3000);
    expect(world.players[0]!.supplyUsed).toBe(before + 1);
    let diedAt = -1;
    for (let t = 0; t < 3700 && diedAt < 0; t++) {
      const res = step(world, catalog, []);
      if (res.events.some((e) => e.type === 'died' && e.entity === n.id)) diedAt = world.tick - 1;
    }
    expect(diedAt).toBe(3600);
    expect(world.players[0]!.supplyUsed).toBe(before);
    expect(checkInvariants(world, catalog)).toEqual([]);
  });
});
