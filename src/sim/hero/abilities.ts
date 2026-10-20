// Heroes' special orders (main tab, heroes table; architecture: 2–3 fixed abilities, no skill
// tree). An ability has a cooldown; the order is refused while it cools down.
//
//   big_meal (Big Mac)  swallows an enemy unit of up to 400 hit points next to him; 30 s
//   clean    (Big Mac)  clears the pus within 4 tiles and heals his side's units there by 40; 20 s
//   scan     (Dendra)   shows everything within 16 tiles of her (beyond her own sight) for 8 seconds; 25 s
//
// Dendra also samples in one second instead of five (her unit's `sampleTicks`).

import type { Cmd, RejectReason } from '../commands/commands';
import type { SimContext } from '../context';
import { SUB } from '../core/fixed';
import { entityById, type Entity, type World } from '../core/world';
import { gap } from '../combat/combat';
import { allied, canSee } from '../vision/vision';

export const COOLDOWN: Record<string, number> = { big_meal: 600, clean: 400, scan: 500 };
export const BIG_MEAL_HP = 400;
export const BIG_MEAL_REACH = SUB + SUB / 2;
export const CLEAN_RADIUS = 4 * SUB;
export const CLEAN_HEAL = 40;
export const SCAN_RADIUS = 16 * SUB;
export const SCAN_TICKS = 160;

export type AbilityEvent = { type: 'ability'; entity: number; owner: number; ability: string; target: number; x: number; y: number };

type Ability = Extract<Cmd, { type: 'ABILITY' }>;

function caster(ctx: SimContext, units: Entity[], ability: string): Entity | undefined {
  return [...units].sort((a, b) => a.id - b.id).find((u) => ctx.catalog.units.get(u.type)?.abilities.includes(ability));
}

export function validateAbility(world: World, ctx: SimContext, player: number, cmd: Ability, units: Entity[]): RejectReason | null {
  const h = caster(ctx, units, cmd.ability);
  if (!h) return 'no_ability';
  if ((h.ready[cmd.ability] ?? 0) > world.tick) return 'cooling_down';
  if (cmd.ability === 'big_meal') {
    const t = entityById(world, cmd.target);
    if (!t || t.hp <= 0 || t.building || t.owner === 0 || allied(world, player, t.owner) || !canSee(ctx, player, t)) return 'unknown_target';
    if (t.hp > BIG_MEAL_HP) return 'bad_target';
    if (gap(ctx, h, t) > BIG_MEAL_REACH) return 'out_of_reach';
  }
  return null;
}

export function applyAbility(world: World, ctx: SimContext, cmd: Ability, units: Entity[], events: AbilityEvent[]): void {
  const h = caster(ctx, units, cmd.ability)!;
  h.ready[cmd.ability] = world.tick + COOLDOWN[cmd.ability]!;
  let target = 0;
  if (cmd.ability === 'big_meal') {
    const t = entityById(world, cmd.target)!;
    t.hp = 0;
    t.lastCombat = world.tick;
    h.lastCombat = world.tick;
    target = t.id;
  } else if (cmd.ability === 'clean') {
    const r2 = CLEAN_RADIUS * CLEAN_RADIUS;
    const w = ctx.map.w;
    world.pus = world.pus.filter((p) => {
      const px = (p.i % w) * SUB + SUB / 2;
      const py = Math.floor(p.i / w) * SUB + SUB / 2;
      const gone = (px - h.x) ** 2 + (py - h.y) ** 2 <= r2;
      if (gone) ctx.pus[p.i] = 0;
      return !gone;
    });
    for (const e of world.entities) {
      if (e.building || e.hp <= 0 || !allied(world, h.owner, e.owner) || e.owner === 0) continue;
      if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= r2) e.hp = Math.min(e.maxHp, e.hp + CLEAN_HEAL);
    }
  } else if (cmd.ability === 'scan') {
    world.reveals.push({ player: h.owner, x: h.x, y: h.y, r: SCAN_RADIUS, until: world.tick + SCAN_TICKS });
  }
  events.push({ type: 'ability', entity: h.id, owner: h.owner, ability: cmd.ability, target, x: h.x, y: h.y });
}
