// Content definitions as stored in content/*.json. Every number is an integer in sim units:
// time in ticks, distance in sub-tiles (1/256 tile), speed in sub-tiles per tick,
// multipliers in thousandths. Costs are [basic, advanced].

export type FactionId = 'wl' | 'col' | 'crn';
export type NavClass = 'small' | 'medium' | 'large';
export type WeaponKind = 'melee' | 'projectile' | 'arc' | 'engulf';
export type Tag = 'worker' | 'biological' | 'armored' | 'building' | 'capsule' | 'concealed' | 'air' | 'hero' | 'structure';

export interface WeaponDef {
  id: string;
  kind: WeaponKind;
  damage: number;
  cooldown: number; // ticks between shots
  windup: number; // ticks from start of attack to impact
  range: number; // sub-tiles, edge to edge
  minRange: number;
  splash: number; // sub-tiles radius, 0 = single target
  arc: number; // degrees of an arc attack, 0 = none
  bonus: Partial<Record<Tag, number>>; // multiplier in thousandths against a tag
  maxTargets: number;
  engulfMaxHp: number; // engulf only: instant kill threshold
}

export interface UnitDef {
  id: string; // also the asset id
  faction: FactionId;
  role: 'worker' | 'builder' | 'scout' | 'infantry' | 'antiarmor' | 'heavy' | 'intel' | 'siege';
  cost: [number, number];
  trainTicks: number;
  supply: number;
  hp: number;
  armor: number;
  speed: number;
  radius: number;
  navClass: NavClass;
  sight: number;
  weapon: string | null;
  tags: Tag[];
  carry: number; // resource per trip, 0 = not a gatherer
  lifespan: number; // ticks, 0 = unlimited
  producedAt: string;
  requires: string[]; // building ids or "antigen:<family>"
  morphsTo: string | null; // monocyte → macrophage
}

export interface BuildingDef {
  id: string;
  faction: FactionId;
  role: 'hq' | 'expansion' | 'supply' | 'dropoff' | 'production' | 'extractor' | 'defense' | 'tech';
  cost: [number, number];
  buildTicks: number;
  hp: number;
  armor: number;
  footprint: [number, number]; // tiles
  supplyProvided: number;
  dropoff: boolean;
  produces: string[];
  requires: string[];
  sight: number;
  critical: boolean; // destroying every critical building defeats the owner
  onResource: 'protein' | 'iron' | null;
  weapon: string | null;
  needsBiofilm: boolean;
  workSlots: number; // extractors: carriers that can work it at once; 0 for every other building
}

export type ResourceKind = 'glucose' | 'protein' | 'iron';

/** A neutral resource on the map. Glucose is worked directly; protein and iron through an extractor. */
export interface ResourceDef {
  id: string; // also the asset id
  kind: ResourceKind;
  stock: number;
  footprint: [number, number]; // tiles
  slots: number; // carriers that can work it at once; 0 = only through an extractor on top
  harvestTicks: number; // time to fill one load
}

export interface FactionDef {
  id: FactionId;
  hq: string;
  start: { unit: string; count: number }[];
  basic: number;
  advanced: number;
  supplyCap: number;
  basicName: string;
  advancedName: string;
}

export interface ContentFiles {
  units: UnitDef[];
  buildings: BuildingDef[];
  weapons: WeaponDef[];
  resources: ResourceDef[];
  factions: FactionDef[];
}

export type TerrainKind = 'open' | 'wall' | 'blood';

export interface FlowDef {
  rect: [number, number, number, number]; // tile x, y, w, h
  dir: [number, number]; // any length; normalized when compiled
  strength: number; // thousandths: 1000 = twice as fast downstream, half upstream
}

export interface MapDef {
  id: string;
  name: string;
  w: number; // tiles
  h: number;
  ground: string; // tile asset id
  legend: Record<string, TerrainKind>;
  rows: string[];
  flows: FlowDef[];
  starts: [number, number][]; // HQ top-left tile per start position
  resources: MapResource[];
  fields: { id: number; name: string }[]; // glucose fields, named for the interface
}

export interface MapResource {
  type: string; // resource id
  tile: [number, number]; // top-left
  field: number; // crystals of one field share it; 0 for a deposit
}
