// Validates content files and compiles them into a catalog with stable numeric indices.
// Validation runs in tests and at load; a catalog that fails never reaches the simulation.

import { hashJson } from '../core/hash';
import { isInt } from '../core/fixed';
import type { BuildingDef, ContentFiles, FactionDef, Tag, UnitDef, WeaponDef } from './types';

export interface Catalog {
  units: Map<string, UnitDef>;
  buildings: Map<string, BuildingDef>;
  weapons: Map<string, WeaponDef>;
  factions: Map<string, FactionDef>;
  /** stable index per type id, used in hashing and snapshots */
  typeIndex: Map<string, number>;
  typeIds: string[];
  hash: string;
}

const TAGS: Tag[] = ['worker', 'biological', 'armored', 'building', 'capsule', 'concealed', 'air', 'hero', 'structure'];

export function validateContent(c: ContentFiles, knownAssets?: Set<string>): string[] {
  const errors: string[] = [];
  const e = (m: string) => errors.push(m);
  const ints = (where: string, obj: object, fields: string[], min = 0) => {
    for (const f of fields) {
      const v = (obj as Record<string, unknown>)[f];
      if (!isInt(v) || v < min) e(`${where}.${f} must be an integer ≥ ${min} (got ${String(v)})`);
    }
  };
  const ids = new Set<string>();
  const unique = (id: string, where: string) => {
    if (ids.has(id)) e(`${where}: duplicate id ${id}`);
    ids.add(id);
  };
  const weapons = new Map(c.weapons.map((w) => [w.id, w]));
  const units = new Map(c.units.map((u) => [u.id, u]));
  const buildings = new Map(c.buildings.map((b) => [b.id, b]));

  for (const w of c.weapons) {
    const at = `weapon ${w.id}`;
    unique(w.id, at);
    ints(at, w, ['damage', 'cooldown', 'range', 'minRange', 'splash', 'arc', 'windup', 'maxTargets', 'engulfMaxHp']);
    if (w.cooldown < 1) e(`${at}: cooldown must be at least 1 tick`);
    if (w.windup > w.cooldown) e(`${at}: windup longer than cooldown`);
    if (w.minRange >= w.range && w.range > 0) e(`${at}: minRange must be below range`);
    if (w.maxTargets < 1) e(`${at}: maxTargets must be at least 1`);
    for (const [tag, m] of Object.entries(w.bonus)) {
      if (!TAGS.includes(tag as Tag)) e(`${at}: unknown bonus tag ${tag}`);
      if (!isInt(m) || m < 0) e(`${at}: bonus ${tag} must be an integer in thousandths`);
    }
    if (w.kind === 'engulf' && w.engulfMaxHp < 1) e(`${at}: engulf needs engulfMaxHp`);
  }

  for (const u of c.units) {
    const at = `unit ${u.id}`;
    unique(u.id, at);
    if (!u.id.startsWith(`unit_${u.faction}_`) && !u.id.startsWith(`hero_${u.faction}_`)) e(`${at}: id must start with unit_${u.faction}_`);
    ints(at, u, ['trainTicks', 'supply', 'armor', 'carry', 'lifespan']);
    ints(at, u, ['hp', 'speed', 'radius', 'sight'], 1);
    if (!Array.isArray(u.cost) || u.cost.length !== 2 || !u.cost.every((v) => isInt(v) && v >= 0)) e(`${at}: cost must be [basic, advanced]`);
    if (u.weapon !== null && !weapons.has(u.weapon)) e(`${at}: unknown weapon ${u.weapon}`);
    for (const t of u.tags) if (!TAGS.includes(t)) e(`${at}: unknown tag ${t}`);
    if (u.producedAt && !buildings.has(u.producedAt) && !units.has(u.producedAt)) e(`${at}: producedAt ${u.producedAt} does not exist`);
    if (u.morphsTo !== null && !units.has(u.morphsTo)) e(`${at}: morphsTo ${u.morphsTo} does not exist`);
    for (const r of u.requires) if (!r.startsWith('antigen:') && !buildings.has(r)) e(`${at}: requires unknown ${r}`);
    if (u.role === 'worker' && u.carry < 1) e(`${at}: a worker must carry something`);
    if (knownAssets && !knownAssets.has(u.id)) e(`${at}: no asset with this id`);
  }

  for (const b of c.buildings) {
    const at = `building ${b.id}`;
    unique(b.id, at);
    if (!b.id.startsWith(`bld_${b.faction}_`)) e(`${at}: id must start with bld_${b.faction}_`);
    ints(at, b, ['buildTicks', 'armor', 'supplyProvided']);
    ints(at, b, ['hp', 'sight'], 1);
    if (!b.footprint.every((v) => isInt(v) && v >= 1 && v <= 6)) e(`${at}: footprint must be 1–6 tiles`);
    for (const p of b.produces) {
      const u = units.get(p);
      if (!u) e(`${at}: produces unknown unit ${p}`);
      else if (u.faction !== b.faction) e(`${at}: produces ${p} of another faction`);
    }
    for (const r of b.requires) if (!r.startsWith('antigen:') && !buildings.has(r)) e(`${at}: requires unknown ${r}`);
    if (b.weapon !== null && !weapons.has(b.weapon)) e(`${at}: unknown weapon ${b.weapon}`);
    if (knownAssets && !knownAssets.has(b.id)) e(`${at}: no asset with this id`);
  }

  // every unit must be producible by exactly the building it names (or be a morph)
  for (const u of c.units) {
    const by = buildings.get(u.producedAt);
    if (by && !by.produces.includes(u.id)) e(`unit ${u.id}: ${u.producedAt} does not list it in produces`);
  }

  // building requirement graph must be acyclic
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      e(`requirement cycle: ${[...path, id].join(' → ')}`);
      return;
    }
    state.set(id, 1);
    for (const r of buildings.get(id)?.requires ?? []) if (buildings.has(r)) visit(r, [...path, id]);
    state.set(id, 2);
  };
  for (const b of c.buildings) visit(b.id, []);

  for (const f of c.factions) {
    const at = `faction ${f.id}`;
    const hq = buildings.get(f.hq);
    if (!hq) e(`${at}: hq ${f.hq} does not exist`);
    else if (!hq.critical) e(`${at}: hq must be critical`);
    ints(at, f, ['basic', 'advanced', 'supplyCap']);
    for (const s of f.start) {
      if (!units.has(s.unit)) e(`${at}: start unit ${s.unit} does not exist`);
      if (!isInt(s.count) || s.count < 1) e(`${at}: start count for ${s.unit}`);
    }
    const startSupply = f.start.reduce((sum, s) => sum + (units.get(s.unit)?.supply ?? 0) * s.count, 0);
    if (hq && startSupply > hq.supplyProvided) e(`${at}: starting units need ${startSupply} supply, hq gives ${hq.supplyProvided}`);
  }
  return errors;
}

export function compileCatalog(c: ContentFiles, knownAssets?: Set<string>): Catalog {
  const errors = validateContent(c, knownAssets);
  if (errors.length) throw new Error('content invalid:\n  ' + errors.join('\n  '));
  const typeIds = [...c.units.map((u) => u.id), ...c.buildings.map((b) => b.id)].sort();
  return {
    units: new Map(c.units.map((u) => [u.id, u])),
    buildings: new Map(c.buildings.map((b) => [b.id, b])),
    weapons: new Map(c.weapons.map((w) => [w.id, w])),
    factions: new Map(c.factions.map((f) => [f.id, f])),
    typeIds,
    typeIndex: new Map(typeIds.map((id, i) => [id, i])),
    hash: hashJson(c).hex(),
  };
}
