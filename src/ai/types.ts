// The opponent's AI (architecture tab, section 8): layers of simple, readable decisions that
// play by the same rules as a person — the same commands, prices and fog.
//
// The AI sees only an Observation (src/sim/vision/observe.ts) and answers with commands. Its
// whole state is plain JSON (AiState): it goes into a save next to the world, and the same
// observations always give the same commands, so a replay or a resumed match agrees.
//
// Nothing in src/ai imports simulation code, only its types (checked by tests/sim/purity).

import type { Catalog } from '../sim/content/catalog';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What each difficulty does differently. Same resources and same fog on every level. */
export interface Level {
  /** ticks between thoughts of each layer */
  eco: number;
  army: number;
  strat: number;
  /** most workers it keeps */
  workers: number;
  /** ticks before it answers an attack on its base */
  react: number;
  /** army value (cost) for a first wave; each wave after needs a quarter more */
  attackAt: number;
  /** thousandths: its army against what it has seen of the enemy's, before it attacks; 0 = never checks */
  ratio: number;
  /** backup timer: the first wave goes by this tick anyway, then every waveGap */
  firstWave: number;
  waveGap: number;
  /** retreats a beaten wave (easy fights to the end: a visible mistake) */
  retreat: boolean;
  scout: boolean;
  /** the Colony's raids on the enemy's carriers */
  raid: boolean;
  /** attacks and raids at the same time */
  multi: boolean;
  expand: boolean;
  tier2: boolean;
  /** defensive buildings it puts up */
  towers: number;
  /** production buildings of the first kind */
  barracks: number;
  /** units queued per production building */
  queue: number;
  /** splits per thought (the Colony) */
  splits: number;
  /** army value it stops adding to (easy keeps a small army) */
  armyCap: number;
}

const S = 20; // ticks per second

/** A thought's commands run this many ticks after it (the same for every AI). */
export const AI_DELAY = 2;

export const LEVELS: Record<Difficulty, Level> = {
  easy: {
    eco: 24, army: 12, strat: 100, workers: 12, react: 80, attackAt: 1400, ratio: 0, firstWave: 8 * 60 * S, waveGap: 4 * 60 * S,
    retreat: false, scout: false, raid: false, multi: false, expand: false, tier2: false, towers: 0, barracks: 1, queue: 1, splits: 0, armyCap: 800,
  },
  normal: {
    eco: 10, army: 6, strat: 60, workers: 20, react: 24, attackAt: 1300, ratio: 1200, firstWave: 8 * 60 * S, waveGap: 150 * S,
    retreat: true, scout: true, raid: true, multi: false, expand: true, tier2: true, towers: 1, barracks: 1, queue: 2, splits: 1, armyCap: 100_000,
  },
  hard: {
    eco: 8, army: 4, strat: 40, workers: 26, react: 6, attackAt: 1100, ratio: 1050, firstWave: 6 * 60 * S, waveGap: 120 * S,
    retreat: true, scout: true, raid: true, multi: true, expand: true, tier2: true, towers: 2, barracks: 2, queue: 2, splits: 3, armyCap: 100_000,
  },
};

/** A group of units on one errand. */
export interface Squad {
  units: number[];
  /** where it is going, sub-tiles */
  x: number;
  y: number;
  /** its hit points when it set out */
  hp0: number;
  since: number;
  /** last tick it was given an order */
  told: number;
}

/** An expansion under way: the field, the site, and the unit that will make it. */
export interface Expansion {
  field: number;
  tx: number;
  ty: number;
  /** the feeder that walks there (the Colony) or the platelets that stand there (the White Line) */
  unit: number;
  tries: number;
  since: number;
}

export interface AiState {
  v: 1;
  player: number;
  faction: string;
  level: Difficulty;
  /** next tick each layer thinks: economy, army, strategy */
  next: [number, number, number];
  mode: 'build' | 'attack';
  waves: number;
  attack: Squad | null;
  raid: Squad | null;
  /** no raid before this tick */
  raidAt: number;
  /** when enemies were first seen at the base this time (-1: none now) */
  threatSince: number;
  /** enemy units it has seen: id → [value, tick last seen] */
  seen: Record<string, [number, number]>;
  scout: number;
  scoutStep: number;
  /** a plan item or building type → failures to build it */
  fails: Record<string, number>;
  /** a plan item → no new attempt before this tick */
  skip: Record<string, number>;
  /** sites that failed: "type@tx,ty" */
  bad: string[];
  /** an order sent and not yet visible in the observation: key → until when it counts */
  pend: Record<string, number>;
  /** production building id → next index into its unit mix */
  mix: Record<string, number>;
  expand: Expansion | null;
  /** fields it gave up expanding to */
  badFields: number[];
  /** sequence number of its last command */
  seq: number;
  /** what its commands still on their way will spend: [tick sent, basic, advanced, supply] */
  inflight: [number, number, number, number][];
  /** set once it has surrendered, with the reason */
  surrendered: string;
  /** the last decision, for the debug layer (Hebrew) */
  note: string;
}

/** What the AI may ask of the match besides its observation: static content and "could this stand here?". */
export interface AiServices {
  catalog: Catalog;
  /** null if `type` could be placed with its top-left tile at (tx, ty), as far as this player can see; else the reason */
  place(type: string, tx: number, ty: number): string | null;
  /** open ground (not a wall or blood) */
  open(tx: number, ty: number): boolean;
}

export function newAiState(player: number, faction: string, level: Difficulty): AiState {
  // the layers of different players think on different ticks
  const o = player * 3;
  return {
    v: 1, player, faction, level, next: [o % 7, (o + 1) % 5, 40 + o], mode: 'build', waves: 0, attack: null, raid: null, raidAt: 90 * S,
    threatSince: -1, seen: {}, scout: 0, scoutStep: 0, fails: {}, skip: {}, bad: [], pend: {}, mix: {}, expand: null, badFields: [],
    seq: 0, inflight: [], surrendered: '', note: '',
  };
}
