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
  cooldown: number; // ticks between launches
  windup: number; // ticks from the start of an attack to its launch
  range: number; // sub-tiles, edge to edge
  minRange: number;
  splash: number; // sub-tiles radius, 0 = single target
  arc: number; // degrees of an arc attack, 0 = none
  bonus: Partial<Record<Tag, number>>; // multiplier in thousandths against a tag
  maxTargets: number;
  engulfMaxHp: number; // engulf only: instant kill threshold
  speed: number; // projectile speed, sub-tiles per tick; 0 = hits at launch
  onTargetLost: 'fizzle' | 'ground'; // a projectile whose target dies first: gone, or lands at the last point
  slow: number; // thousandths taken off the target's speed
  slowTicks: number;
  arcCos: number; // cos(arc / 2) in thousandths, from the content tool (the simulation has no trigonometry)
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
  /** where it may be placed: near own buildings, where a builder stands, on a deposit, on own biofilm, or never */
  placement: Placement;
  art: string; // asset drawn for it (usually its own id)
  artScale: number; // thousandths
}

export type Placement = 'near' | 'builder' | 'resource' | 'biofilm' | 'none';

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
  /** how it builds: ordered at the lymph node, a worker turned into the building (gate 6), or hijacked cells (gate 6) */
  construction: 'order' | 'morph' | 'hijack';
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
