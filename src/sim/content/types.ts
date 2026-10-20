// Content definitions as stored in content/*.json. Every number is an integer in sim units:
// time in ticks, distance in sub-tiles (1/256 tile), speed in sub-tiles per tick,
// multipliers in thousandths. Costs are [basic, advanced].

export type FactionId = 'wl' | 'col' | 'crn' | 'neu';
export type NavClass = 'small' | 'medium' | 'large';
export type WeaponKind = 'melee' | 'projectile' | 'arc' | 'engulf';
export type Tag = 'worker' | 'biological' | 'armored' | 'building' | 'capsule' | 'concealed' | 'air' | 'hero' | 'structure' | 'acquired' | 'infected';

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
  antibody: boolean; // antibodies lose 60% against anything standing on biofilm
}

export interface UnitDef {
  id: string; // also the asset id
  faction: FactionId;
  role: 'worker' | 'builder' | 'scout' | 'infantry' | 'antiarmor' | 'heavy' | 'intel' | 'siege' | 'commando' | 'support';
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
  family: string; // antigen family a sample of it opens; '' for the White Line
  aura: '' | 'helper'; // helper: IL-2 for acquired cells and IFN-γ for macrophages nearby
  abilities: string[]; // a hero's special orders (src/sim/hero/abilities.ts)
  sampleTicks: number; // a dendritic cell's sampling time; 0 = the usual
}

export interface BuildingDef {
  id: string;
  faction: FactionId;
  role: 'hq' | 'expansion' | 'supply' | 'dropoff' | 'production' | 'extractor' | 'defense' | 'tech' | 'host';
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
  family: string; // antigen family a sample of it opens
  zone: string; // '' or a zone kind it must stand in, on maps that mark that kind
}

export type Placement = 'near' | 'builder' | 'resource' | 'biofilm' | 'anywhere' | 'none';

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
  /** a painted map: the picture drawn as its ground (asset id); its walls are traced in `rows` */
  art?: string;
  /** special building zones: tile indices (y × w + x) of each kind (B: follicles, T: paracortex) */
  zones?: { kind: string; tiles: number[] }[];
}

export interface MapResource {
  type: string; // resource id
  tile: [number, number]; // top-left
  field: number; // crystals of one field share it; 0 for a deposit
}

// ---------------------------------------------------------------- missions (gate 7)

/** A rectangle of tiles: [x, y, w, h]. */
export type TileRect = [number, number, number, number];

/** What a trigger waits for; all of a trigger's conditions must hold. */
export type MissionCond =
  | { t: 'time'; at: number } // the tick has come
  | { t: 'objective'; id: string; is: 'active' | 'done' | 'failed' }
  | { t: 'units_in'; owner: number; rect: TileRect; n: number; role?: string; type?: string } // n or more there
  | { t: 'none_tagged'; tag: string } // every entity with this tag is gone
  | { t: 'tagged'; tag: string } // something with this tag still stands
  | { t: 'infl'; above?: number; below?: number } // inflammation (thousandths) above / below
  | { t: 'count'; owner: number; type: string; n: number } // n or more of a type (buildings finished)
  | { t: 'made'; owner: number; type: string; n: number } // n or more of a unit trained so far
  | { t: 'antigen'; owner: number } // a family opened
  | { t: 'no_army'; owner: number }; // no units and no buildings left

/** What a trigger does. */
export type MissionAction =
  | { a: 'spawn'; owner: number; type: string; n: number; at: [number, number] | 'gates'; tag?: string; go?: [number, number] }
  | { a: 'objective'; id: string; state: 'active' | 'done' | 'failed' }
  | { a: 'say'; speaker: string; text: string }
  | { a: 'win' }
  | { a: 'lose'; reason: string }
  | { a: 'stop'; trigger: string } // switch a trigger off
  | { a: 'grant'; owner: number; basic: number; advanced: number }
  | { a: 'inflame'; amount: number }; // thousandths of a point

export interface MissionTrigger {
  id: string;
  when: MissionCond[];
  do: MissionAction[];
  /** fires again this many ticks after it last did, while its conditions hold; absent = once */
  every?: number;
  /** a reinforcement: comes 25% sooner while inflammation is active (31–60) */
  fast?: boolean;
  /** the conditions must have held this many ticks in a row */
  hold?: number;
}

/** Something on the map when the mission begins. Units: a tile to stand on; buildings: their top-left tile. */
export interface MissionPlace {
  owner: number;
  type: string;
  at: [number, number];
  n?: number;
  tag?: string;
  /** hit points other than the type's (a sturdier cluster) */
  hp?: number;
}

export interface MissionDef {
  id: string;
  number: number;
  title: string;
  map: string;
  /** the side the player plays, and the enemy's; player 1 and 2 */
  player: { faction: FactionId; basic: number; advanced: number };
  enemy: { faction: FactionId; basic: number; advanced: number; ai?: 'easy' | 'normal' | 'hard' };
  /** host cells (their tiles) and the tissue integrity below which the mission fails (thousandths) */
  host: { cells: [number, number][]; tissueMin: number };
  place: MissionPlace[];
  /** exit gates on the vessels: tile, and the inflammation (thousandths) that opens it */
  gates: { at: [number, number]; infl: number }[];
  objectives: { id: string; text: string; hidden?: boolean }[];
  triggers: MissionTrigger[];
  /** heroes whose death loses the mission are tagged 'hero' in `place` */
  cine: string;
  briefing: { speaker: string; text: string }[];
  truth: { title: string; text: string };
  /** where the camera starts, a tile */
  camera: [number, number];
}
