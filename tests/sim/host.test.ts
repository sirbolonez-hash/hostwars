// Gate 7: the host around the battle. Inflammation and its tiers, fever, pressure, tissue;
// pus and NETs; heroes' abilities; zones; exit gates and reinforcements.
import { describe, expect, it } from 'vitest';
import { checkPlacement } from '../../src/sim/build/placement';
import type { Cmd } from '../../src/sim/commands/commands';
import { missionContext } from '../../src/sim/content/load';
import type { SimContext } from '../../src/sim/context';
import { spawnUnit, type Entity, type World } from '../../src/sim/core/world';
import { COOLDOWN, SCAN_TICKS } from '../../src/sim/hero/abilities';
import { INFL_NET, INFL_NEUTROPHIL_DEATH, NET_DAMAGE, NET_STUN, STORM_TICKS, tissueOf } from '../../src/sim/host/host';
import { startMission } from '../../src/sim/mission/mission';
import { step, type SimEvent } from '../../src/sim/sim';
import { canSee } from '../../src/sim/vision/vision';
import { arenaMatch, catalog } from './helpers';

const T = 256;

/** Mission 1's map and host, emptied of everything but the host cells: a lab for the host's rules. */
function lab(id = 'm01') {
  const ctx = missionContext(id);
  const world = startMission(ctx, 3);
  world.entities = world.entities.filter((e) => e.owner === 0);
  for (const p of world.players) p.supplyUsed = 0;
  // no triggers: the rules alone
  world.mission!.stopped = ctx.mission!.triggers.map((t) => t.id);
  let seq = 0;
  const events: SimEvent[] = [];
  return {
    ctx,
    world,
    events,
    put: (type: string, owner: number, tx: number, ty: number): Entity => {
      const e = spawnUnit(world, catalog, type, owner, tx * T + 128, ty * T + 128);
      if (type.startsWith('hero_')) e.tag = 'hero'; // a mission with a hero is lost without one
      return e;
    },
    cmd(player: number, cmd: Cmd) {
      return { player, seq: ++seq, tick: world.tick, cmd };
    },
    run(n: number, cmds: ReturnType<typeof this.cmd>[] = []) {
      for (let k = 0; k < n; k++) {
        const r = step(world, ctx, k === 0 ? cmds : []);
        events.push(...r.events);
        if (world.outcome) return;
      }
    },
  };
}

describe('the monitor (gate 7)', () => {
  it('a neutrophil dying raises inflammation by 2; it ebbs, faster once nothing is hit, faster with Tregs', () => {
    const l = lab();
    const n = l.put('unit_wl_neutrophil', 1, 20, 30);
    n.hp = 0;
    l.run(1);
    expect(l.world.host!.infl).toBe(INFL_NEUTROPHIL_DEATH - 15 - 25); // the death, the ebb, the calm (no hit for long)
    const before = l.world.host!.infl;
    l.put('unit_wl_treg', 1, 22, 30);
    l.run(10);
    expect(l.world.host!.infl).toBe(before - 10 * (15 + 25 + 10));
  });

  it('a cytokine storm held for 60 seconds loses the patient', () => {
    const l = lab();
    for (let k = 0; k < STORM_TICKS + 2 && !l.world.outcome; k++) {
      l.world.host!.infl = 95_000;
      l.run(1);
    }
    expect(l.world.outcome).toMatchObject({ winnerTeam: 2, reason: 'cytokine_storm' });
  });

  it('a raging inflammation drops the pressure into shock, and burns 1% of the tissue a minute', () => {
    const l = lab();
    let minute = -1;
    for (let k = 0; k < 6000 && !l.world.outcome; k++) {
      l.world.host!.infl = 70_000;
      l.run(1);
      if (k === 1199) minute = tissueOf(l.world, l.ctx);
    }
    expect(minute).toBe(990);
    expect(l.world.outcome).toMatchObject({ winnerTeam: 2, reason: 'shock' });
    expect(l.world.host!.pressure).toBeLessThan(50_000);
  });

  it('a fever of 38–39 makes immune cells 10% faster', () => {
    const walk = (infl: number) => {
      const l = lab();
      const u = l.put('unit_wl_neutrophil', 1, 20, 30);
      const x0 = u.x;
      const go = l.cmd(1, { type: 'MOVE', units: [u.id], x: 28 * T, y: u.y });
      for (let k = 0; k < 30; k++) {
        l.world.host!.infl = infl;
        l.run(1, k === 0 ? [go] : []);
      }
      return u.x - x0;
    };
    const cool = walk(0);
    const warm = walk(40_000);
    expect(warm).toBeGreaterThan(cool);
    expect(warm * 1000).toBeLessThanOrEqual(cool * 1120);
  });
});

describe('pus and NETs (gate 7)', () => {
  it('a neutrophil dies: pus around it; everyone walks slower there; a macrophage cleans it and heals', () => {
    const l = lab();
    const n = l.put('unit_wl_neutrophil', 1, 20, 30);
    n.hp = 0;
    l.run(2);
    expect(l.world.pus.length).toBe(9);
    expect(l.ctx.pus[30 * l.ctx.map.w + 20]).toBe(1);
    const m = l.put('unit_wl_macrophage', 1, 20, 30);
    m.hp = 100;
    l.run(80);
    expect(l.ctx.pus[30 * l.ctx.map.w + 20]).toBe(0);
    expect(m.hp).toBeGreaterThan(100);
  });

  it('a NET: enemies within 3 tiles held 6 seconds and hit for 40; the neutrophil is gone; inflammation and pus', () => {
    const l = lab();
    const n = l.put('unit_wl_neutrophil', 1, 20, 30);
    const near = l.put('unit_col_strep', 2, 22, 30);
    const far = l.put('unit_col_coccus', 2, 26, 30);
    const hp = near.hp;
    l.run(1, [l.cmd(1, { type: 'NET', units: [n.id] })]);
    expect(l.events.some((e) => e.type === 'net')).toBe(true);
    expect(near.hp).toBe(hp - NET_DAMAGE);
    expect(near.stun).toBe(NET_STUN);
    expect(far.stun).toBe(0);
    expect(l.world.entities.find((e) => e.id === n.id)).toBeUndefined();
    expect(l.world.host!.infl).toBe(INFL_NET + INFL_NEUTROPHIL_DEATH - 15);
    l.run(1);
    expect(l.world.pus.length).toBeGreaterThan(0);
    // held: it neither moves nor strikes while the net lasts
    const victim = l.put('unit_wl_neutrophil', 1, 23, 30);
    const [x, y] = [near.x, near.y];
    l.run(NET_STUN - 10);
    // it does not walk (bodies passing may nudge it a little)
    expect(Math.abs(near.x - x) + Math.abs(near.y - y)).toBeLessThan(T / 2);
    expect(l.events.some((e) => e.type === 'launched' && e.entity === near.id)).toBe(false);
    l.run(40);
    expect(l.events.some((e) => e.type === 'launched' && e.entity === near.id && e.target === victim.id)).toBe(true);
  });
});

describe('heroes (gate 7)', () => {
  it("Big Mac's big meal: an enemy of up to 400 hit points next to him, then a cooldown", () => {
    const l = lab('m02');
    const mac = l.put('hero_wl_bigmac', 1, 60, 30);
    const small = l.put('unit_col_strep', 2, 61, 30);
    const far = l.put('unit_col_coccus', 2, 66, 30);
    const big = l.put('unit_col_strep', 2, 59, 31);
    big.hp = 500;
    big.maxHp = 500;
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [mac.id], ability: 'big_meal', target: far.id })]);
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [mac.id], ability: 'big_meal', target: big.id })]);
    const refused = l.events.filter((e) => e.type === 'rejected').map((e) => (e as { rejection: { reason: string } }).rejection.reason);
    expect(refused).toEqual(['out_of_reach', 'bad_target']);
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [mac.id], ability: 'big_meal', target: small.id })]);
    expect(l.world.entities.find((e) => e.id === small.id)).toBeUndefined();
    expect(mac.ready['big_meal']).toBe(l.world.tick - 1 + COOLDOWN['big_meal']!);
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [mac.id], ability: 'big_meal', target: big.id })]);
    expect(l.events.filter((e) => e.type === 'rejected').at(-1)).toMatchObject({ rejection: { reason: 'cooling_down' } });
  });

  it("Big Mac's clean: the pus within 4 tiles is gone and his side's units there heal", () => {
    const l = lab('m02');
    const mac = l.put('hero_wl_bigmac', 1, 60, 30);
    const n = l.put('unit_wl_neutrophil', 1, 62, 30);
    n.hp = 0;
    const friend = l.put('unit_wl_monocyte', 1, 58, 31);
    friend.hp = 10;
    l.run(2);
    expect(l.world.pus.length).toBeGreaterThan(0);
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [mac.id], ability: 'clean', target: 0 })]);
    expect(l.world.pus.length).toBe(0);
    expect(friend.hp).toBe(50);
  });

  it("Dendra's scan shows what is around her for 8 seconds; she samples in one second", () => {
    const l = lab('m03');
    const d = l.put('hero_wl_dendra', 1, 50, 36);
    const hidden = l.put('unit_col_coccus', 2, 50, 36 - 14);
    hidden.cb = null; // a quiet target: nobody fights
    l.run(1);
    expect(canSee(l.ctx, 1, hidden)).toBe(false); // beyond her sight of 11
    l.run(1, [l.cmd(1, { type: 'ABILITY', units: [d.id], ability: 'scan', target: 0 })]);
    expect(canSee(l.ctx, 1, hidden)).toBe(true);
    l.run(SCAN_TICKS + 2);
    expect(l.world.reveals.length).toBe(0);
    expect(canSee(l.ctx, 1, hidden)).toBe(false);
    // sampling
    const target = l.put('unit_col_coccus', 2, 51, 36);
    target.hp = 10_000;
    target.maxHp = 10_000;
    l.run(1, [l.cmd(1, { type: 'SAMPLE', units: [d.id], target: target.id })]);
    const at = l.world.tick;
    l.run(60);
    const sampled = l.events.find((e) => e.type === 'sampled' && e.entity === d.id);
    expect(sampled).toBeDefined();
    expect(sampled!.tick - at).toBeLessThanOrEqual(25);
  });
});

describe('zones, gates and reinforcements (gate 7)', () => {
  it('a thymus stands only in a T zone and a germinal centre only in a follicle, where the map marks them', () => {
    const l = lab('m03');
    l.put('unit_wl_glut', 1, 52, 36);
    const tz = l.ctx.zones.get('T')!;
    const bz = l.ctx.zones.get('B')!;
    const w = l.ctx.map.w;
    const inside = (g: Uint8Array) => {
      for (let i = 0; i < g.length; i++) {
        const [x, y] = [i % w, Math.floor(i / w)];
        if (g[i] && g[i + 1] && g[i + 2] && g[i + w] && g[i + 2 * w] && g[i + 2 * w + 2] && g[i + w + 2]) return [x, y] as const;
      }
      return [0, 0] as const;
    };
    const [tx, ty] = inside(tz);
    const [bx, by] = inside(bz);
    const placed = (type: string, x: number, y: number) => {
      const c = checkPlacement(l.world, l.ctx, 1, type, x, y);
      return c.ok ? 'ok' : c.reason;
    };
    expect(placed('bld_wl_thymus', bx, by)).toBe('wrong_zone');
    expect(placed('bld_wl_germinal', tx, ty)).toBe('wrong_zone');
    expect(['ok', 'too_far']).toContain(placed('bld_wl_thymus', tx, ty));
    expect(['ok', 'too_far']).toContain(placed('bld_wl_germinal', bx, by));
    // the arena marks no zones: anywhere goes
    const a = arenaMatch();
    const c = checkPlacement(a.world, a.ctx, 1, 'bld_wl_thymus', 15, 30);
    expect(c.ok || c.reason !== 'wrong_zone').toBe(true);
  });

  it('active inflammation opens more exit gates and brings reinforcements a quarter sooner', () => {
    const count = (infl: number) => {
      const ctx = missionContext('m01');
      const world = startMission(ctx, 3);
      // only the reinforcements run
      world.mission!.stopped = ctx.mission!.triggers.filter((t) => t.id !== 'reinforce').map((t) => t.id);
      const gates = new Set<number>();
      const waves = new Set<number>();
      let last = world.nextId;
      for (let k = 0; k < 6 * 1200; k++) {
        world.host!.infl = infl;
        world.host!.lastFight = world.tick; // nothing ebbs here
        step(world, ctx, []);
        for (const e of world.entities) {
          if (e.id < last || e.owner !== 1) continue;
          waves.add(e.bornTick);
          gates.add(Math.floor(e.x / T / 6));
        }
        last = world.nextId;
      }
      return { waves: waves.size, gates: gates.size };
    };
    const calm = count(0);
    const active = count(40_000);
    expect(active.waves).toBeGreaterThan(calm.waves);
    expect(active.gates).toBeGreaterThan(calm.gates);
  });

  it('area damage hurts host cells; with nothing else about, bacteria feed on them', () => {
    const l = lab();
    const cell = l.world.entities.find((e) => e.owner === 0 && e.type === 'bld_neu_epithelial')!;
    const hp = cell.hp;
    const [cx, cy] = [Math.floor(cell.x / T), Math.floor(cell.y / T)];
    l.put('unit_col_coccus', 2, cx + 1, cy + 1);
    l.run(200);
    expect(cell.hp).toBeLessThan(hp);
    expect(tissueOf(l.world, l.ctx)).toBeLessThan(1000);
  });
});
