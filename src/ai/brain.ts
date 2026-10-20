// The AI's decisions, layer by layer (architecture tab, section 8):
//
//   economy  (every `eco` ticks)   recovery first, then workers, supply, the build plan, expansion, units
//   army     (every `army` ticks)  defence, the attack wave, raids, scouting, splitting, sampling
//   strategy (every `strat` ticks) when to attack, and when to give up (with the reason)
//
// One spending arbiter: the economy layer decides what the money is for before units are
// queued, so the army and the build plan never spend the same ATP twice. A decision holds for
// a while (a wave is not called back on the next thought unless it is losing).

import type { Cmd } from '../sim/commands/commands';
import type { BuildingDef, UnitDef } from '../sim/content/types';
import type { ObsEntity, ObsOwn, ObsResource, Observation } from '../sim/vision/observe';
import { EXPANSION, MIX, planFor, SUPPLY, type PlanStep } from './plans';
import { AI_DELAY, LEVELS, type AiServices, type AiState, type Level, type Squad } from './types';

const T = 256; // sub-tiles per tile
const S = 20; // ticks per second
/** enemies this close to a building of ours (tiles) are an attack on the base */
const BASE_RADIUS = 16;
/** an order counts as sent for this long before the observation shows it */
const PEND = 30;
/** enemy units not seen for this long drop out of the estimate */
const FORGET = 60 * S;

/** True when some layer is due to think this tick (so the host builds an observation only then). */
export function due(st: AiState, tick: number): boolean {
  return st.surrendered === '' && (tick >= st.next[0] || tick >= st.next[1] || tick >= st.next[2]);
}

/** One thought: the commands to send, for the tick after next. */
export function think(st: AiState, obs: Observation, svc: AiServices): Cmd[] {
  if (st.surrendered !== '' || obs.defeated) return [];
  const lv = LEVELS[st.level];
  // what its commands still on their way will spend is not in the observation yet
  st.inflight = st.inflight.filter((f) => obs.tick - f[0] <= AI_DELAY);
  const k = new Know(obs, svc, st);
  for (const f of st.inflight) {
    k.money -= f[1];
    k.adv -= f[2];
    k.supply -= f[3];
  }
  const out: Cmd[] = [];
  for (const key of Object.keys(st.pend)) if (st.pend[key]! <= obs.tick) delete st.pend[key];
  if (obs.tick >= st.next[2]) {
    st.next[2] = obs.tick + lv.strat;
    strategy(st, k, lv, out);
    if (st.surrendered !== '') return out;
  }
  if (obs.tick >= st.next[0]) {
    st.next[0] = obs.tick + lv.eco;
    economy(st, k, lv, out);
  }
  if (obs.tick >= st.next[1]) {
    st.next[1] = obs.tick + lv.army;
    army(st, k, lv, out);
  }
  const total: [number, number, number] = [0, 0, 0];
  for (const c of out) {
    const [cb, ca, cs] = costOf(k, c);
    total[0] += cb;
    total[1] += ca;
    total[2] += cs;
  }
  if (total[0] > 0 || total[1] > 0 || total[2] > 0) st.inflight.push([obs.tick, ...total]);
  return out;
}

/** What a command will charge when it runs: basic, advanced, supply. */
function costOf(k: Know, c: Cmd): [number, number, number] {
  const cat = k.svc.catalog;
  switch (c.type) {
    case 'TRAIN': {
      const u = cat.units.get(c.unit);
      return u ? [u.cost[0] * c.count, u.cost[1] * c.count, u.supply * c.count] : [0, 0, 0];
    }
    case 'QUEUE_BUILD':
    case 'BUILD_AT': {
      const d = cat.buildings.get(c.build);
      return d ? [d.cost[0], d.cost[1], 0] : [0, 0, 0];
    }
    case 'SPLIT':
    case 'DEPLOY': {
      const r: [number, number, number] = [0, 0, 0];
      for (const id of c.units) {
        const e = k.units.find((u) => u.id === id);
        if (!e) continue;
        const def = cat.units.get(e.type)!;
        const into = c.type === 'DEPLOY' && def.morphsTo ? cat.units.get(def.morphsTo)! : def;
        r[0] += into.cost[0];
        r[1] += into.cost[1];
        r[2] += c.type === 'SPLIT' ? def.supply : Math.max(0, into.supply - def.supply);
      }
      return r;
    }
    default:
      return [0, 0, 0];
  }
}

// ---------------------------------------------------------------- what it knows

/** Facts drawn from one observation, computed once per thought. */
class Know {
  readonly units: ObsOwn[] = [];
  readonly buildings: ObsOwn[] = [];
  readonly done = new Set<string>(); // finished building types
  readonly workers: ObsOwn[] = [];
  readonly fighters: ObsOwn[] = [];
  readonly hqs: ObsOwn[] = [];
  readonly dropoffs: ObsOwn[] = [];
  readonly workerType: string;
  readonly enemyStart: [number, number];
  readonly home: [number, number]; // sub-tiles: the centre of our main building, or where it stood
  readonly rally: [number, number];
  /** what is left to spend this thought, shared by every layer (one spending arbiter) */
  money: number;
  adv: number;
  /** supply left to fill this thought, after what is on its way */
  supply: number;
  constructor(readonly obs: Observation, readonly svc: AiServices, st: AiState) {
    this.money = obs.basic;
    this.adv = obs.advanced;
    this.supply = obs.supplyCap - obs.supplyUsed - obs.supplyReserved;
    const cat = svc.catalog;
    for (const e of obs.own) {
      if (e.building) {
        this.buildings.push(e);
        const d = cat.buildings.get(e.type)!;
        if (!e.growing) {
          this.done.add(e.type);
          if (d.dropoff) this.dropoffs.push(e);
          if (d.produces.some((u) => cat.units.get(u)?.role === 'worker')) this.hqs.push(e);
        }
        continue;
      }
      this.units.push(e);
      const u = cat.units.get(e.type)!;
      if (u.role === 'worker') this.workers.push(e);
      else if (u.weapon !== null && e.id !== st.scout) this.fighters.push(e);
    }
    this.workerType = [...cat.units.values()].find((u) => u.faction === obs.faction && u.role === 'worker')!.id;
    const others = obs.starts.filter((s) => s[0] !== obs.myStart[0] || s[1] !== obs.myStart[1]);
    const hqT = cat.buildings.get(cat.factions.get(obs.faction)!.hq)!.footprint;
    const es = others[0] ?? obs.myStart;
    this.enemyStart = [(es[0] + 2) * T, (es[1] + 2) * T];
    const main = this.hqs[0] ?? this.buildings[0];
    this.home = main ? [main.x, main.y] : [(obs.myStart[0] + hqT[0] / 2) * T, (obs.myStart[1] + hqT[1] / 2) * T];
    // the army waits a little in front of the base, towards the enemy
    const [dx, dy] = towards(this.home, this.enemyStart, 7 * T);
    this.rally = [this.home[0] + dx, this.home[1] + dy];
  }

  unitDef(type: string): UnitDef | undefined {
    return this.svc.catalog.units.get(type);
  }
  bDef(type: string): BuildingDef | undefined {
    return this.svc.catalog.buildings.get(type);
  }
  /** how many of a building or unit type it has, growing or on the way */
  count(type: string, st: AiState): number {
    let n = 0;
    for (const e of this.obs.own) if (e.type === type || e.buildOrder === type || (e.job === 'build_at' && e.jobBuild === type)) n++;
    for (const e of this.obs.own) for (const q of e.queue) if (q === type) n++;
    if ((st.pend[type] ?? 0) > this.obs.tick) n++;
    return n;
  }
  requirementsMet(reqs: string[]): boolean {
    return reqs.every((r) => {
      if (!r.startsWith('antigen:')) return this.done.has(r);
      const fam = r.slice(8);
      return fam === 'any' ? this.obs.antigens.length > 0 : this.obs.antigens.includes(fam);
    });
  }
  /** supply not yet taken (by units or orders already sent) */
  get freeSupply(): number {
    return this.supply;
  }
  value(type: string): number {
    const c = this.unitDef(type)?.cost ?? this.bDef(type)?.cost ?? [0, 0];
    return c[0] + c[1];
  }
  /** enemies we see now, and buildings we remember */
  get known(): ObsEntity[] {
    return [...this.obs.enemies, ...this.obs.remembered];
  }
  armed(e: ObsEntity): boolean {
    return (e.building ? this.bDef(e.type)?.weapon : this.unitDef(e.type)?.weapon) != null;
  }
}

const d2 = (a: { x: number; y: number }, x: number, y: number) => (a.x - x) ** 2 + (a.y - y) ** 2;
const ids = (es: { id: number }[]) => es.map((e) => e.id);

function towards(from: [number, number], to: [number, number], len: number): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const l = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  return [Math.trunc((dx * len) / l), Math.trunc((dy * len) / l)];
}

function centroid(es: { x: number; y: number }[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const e of es) {
    x += e.x;
    y += e.y;
  }
  return [Math.trunc(x / Math.max(1, es.length)), Math.trunc(y / Math.max(1, es.length))];
}

function clampPoint(obs: Observation, x: number, y: number): [number, number] {
  return [Math.min(Math.max(x, T), (obs.mapW - 1) * T - 1), Math.min(Math.max(y, T), (obs.mapH - 1) * T - 1)];
}

// ---------------------------------------------------------------- strategy

function strategy(st: AiState, k: Know, lv: Level, out: Cmd[]): void {
  const obs = k.obs;
  // giving up, with a reason, when nothing can come back
  const canWork = k.workers.length > 0 && k.dropoffs.length > 0;
  const canMakeWorkers = k.hqs.length > 0 && obs.basic >= (k.unitDef(k.workerType)?.cost[0] ?? 0);
  if (k.fighters.length === 0 && !canWork && !canMakeWorkers) {
    const anyProduction = k.buildings.some((b) => !b.growing && (k.bDef(b.type)?.produces.length ?? 0) > 0);
    const affordable = anyProduction && obs.basic >= 40;
    if (!affordable) {
      st.surrendered = k.buildings.length === 0 ? 'no_base' : 'no_economy';
      st.note = 'נכנע: אין כלכלה ואין צבא';
      out.push({ type: 'SURRENDER', units: [], reason: st.surrendered });
      return;
    }
  }
  // the estimate of the enemy's army: what it has seen lately
  for (const e of obs.enemies) if (!e.building && k.armed(e)) st.seen[String(e.id)] = [k.value(e.type), obs.tick];
  let enemy = 0;
  for (const [key, [v, t]] of Object.entries(st.seen)) {
    if (obs.tick - t > FORGET) delete st.seen[key];
    else enemy += v;
  }
  if (st.mode === 'attack') {
    const alive = st.attack ? st.attack.units.filter((id) => k.fighters.some((f) => f.id === id)) : [];
    if (alive.length === 0) {
      st.mode = 'build';
      st.attack = null;
      st.note = 'הגל נגמר';
    }
    return;
  }
  if (st.threatSince >= 0) return; // defend first
  const home = k.fighters.filter((f) => !inSquad(st.raid, f.id));
  let mine = 0;
  for (const f of home) mine += k.value(f.type);
  const need = lv.attackAt + Math.trunc((lv.attackAt * st.waves) / 4);
  const strongEnough = mine >= need && (lv.ratio === 0 || mine * 1000 >= lv.ratio * enemy);
  const backup = obs.tick >= lv.firstWave + st.waves * lv.waveGap && mine >= Math.trunc(lv.attackAt / 2);
  if (!strongEnough && !backup) return;
  const hp0 = home.reduce((s, f) => s + f.hp, 0);
  const [tx, ty] = attackPoint(k, centroid(home));
  st.attack = { units: ids(home), x: tx, y: ty, hp0, since: obs.tick, told: -1 };
  st.mode = 'attack';
  st.waves++;
  st.note = `גל ${st.waves}: ${home.length} יחידות (ערך ${mine} מול הערכה ${enemy})`;
}

/** Where a wave goes: the nearest enemy building it knows of, else where the enemy started. */
function attackPoint(k: Know, from: [number, number]): [number, number] {
  let best: ObsEntity | null = null;
  for (const e of k.known) {
    if (!e.building) continue;
    if (!best || d2(e, from[0], from[1]) < d2(best, from[0], from[1])) best = e;
  }
  return best ? [best.x, best.y] : k.enemyStart;
}

function inSquad(s: Squad | null, id: number): boolean {
  return s !== null && s.units.includes(id);
}

// ---------------------------------------------------------------- economy

function economy(st: AiState, k: Know, lv: Level, out: Cmd[]): void {
  const obs = k.obs;
  let money = k.money;
  let adv = k.adv;
  const spend = (c: [number, number]) => {
    money -= c[0];
    adv -= c[1];
  };
  const afford = (c: [number, number]) => money >= c[0] && adv >= c[1];
  /** what to hold back for something it cannot pay for yet: only the resource that is short */
  const holdFor = (c: [number, number]): [number, number] => (adv < c[1] ? [0, c[1]] : [c[0], c[1]]);

  gather(st, k, out);
  if (obs.faction === 'wl') platelets(k, out);

  // 1. recovery: a Colony without a core builds one again
  if (obs.faction === 'col' && k.hqs.length === 0 && k.workers.length > 0) {
    const core = EXPANSION.col!;
    if (k.count(core, st) === 0 && afford(k.bDef(core)!.cost)) {
      const site = findSite(st, k, core, k.home[0], k.home[1], 14, false);
      if (site && orderBuilding(st, k, core, site, out)) {
        spend(k.bDef(core)!.cost);
        st.note = 'בונה ליבה מחדש';
      }
    }
  }

  // 2. workers, up to what the fields can use
  const crystals = obs.resources.filter((r) => r.kind === 'glucose' && r.slots > 0 && r.stock > 0 && nearDropoff(k, r, 14));
  const extractors = k.buildings.filter((b) => !b.growing && k.bDef(b.type)?.role === 'extractor');
  const want = Math.min(lv.workers, crystals.length * 2 + extractors.length * 3 + 2);
  const workerCost = k.unitDef(k.workerType)!.cost;
  let workersComing = k.count(k.workerType, st) - k.workers.length;
  for (const hq of k.hqs) {
    if (k.workers.length + workersComing >= want || hq.queue.length >= 2 || k.freeSupply < 1) break;
    if (!afford(workerCost)) break;
    out.push({ type: 'TRAIN', units: [], building: hq.id, unit: k.workerType, count: 1 });
    spend(workerCost);
    k.supply -= k.unitDef(k.workerType)!.supply;
    workersComing++;
  }

  // 3. supply before it runs out
  const supplyType = SUPPLY[obs.faction]!;
  const supply = k.bDef(supplyType)!;
  const production = k.buildings.filter((b) => (k.bDef(b.type)?.produces.length ?? 0) > 0).length;
  const maxCap = k.svc.catalog.factions.get(obs.faction)!.supplyCap;
  // supply on its way: anything growing that will give supply, or ordered and not yet standing
  const givesSupply = (type: string) => (k.bDef(type)?.supplyProvided ?? 0) > 0;
  const supplyGrowing =
    k.buildings.some((b) => b.growing && givesSupply(b.type)) ||
    Object.keys(st.pend).some((key) => givesSupply(key) && st.pend[key]! > obs.tick) ||
    k.obs.own.some((e) => (e.buildOrder !== '' && givesSupply(e.buildOrder)) || (e.job === 'build_at' && givesSupply(e.jobBuild)));
  let reserve: [number, number] = [0, 0];
  if (k.freeSupply < 4 + production * 2 && obs.supplyCap < maxCap && !supplyGrowing && k.requirementsMet(supply.requires)) {
    if (afford(supply.cost)) {
      const r = buildNear(st, k, supplyType, 'base', out);
      if (r === 'ok') spend(supply.cost);
      else if (r === 'no_site' && obs.faction === 'col') {
        // no room left on the biofilm: a new core gives supply and spreads more of it
        const core = k.bDef(EXPANSION.col!)!;
        if (k.count(core.id, st) < 4 && afford(core.cost)) {
          const off = towards(k.home, k.enemyStart, -6 * T);
          const site = findSite(st, k, core.id, k.home[0] + off[0], k.home[1] + off[1], 16, true);
          if (site && orderBuilding(st, k, core.id, site, out)) {
            spend(core.cost);
            st.note = 'אין מקום על הביופילם: ליבה נוספת';
          }
        } else reserve = holdFor(core.cost);
      }
    } else reserve = holdFor(supply.cost);
  }

  // a lymph node holding an order places it (whatever it is)
  placeOrders(st, k, out);

  // 4. the build plan: the first step not done whose time has come
  if (reserve[0] === 0) {
    for (const step of planFor(obs.faction, lv)) {
      if (k.count(step.build, st) >= step.n) continue;
      if ((st.skip[step.build] ?? 0) > obs.tick) continue;
      // worker counts pace the opening only: after it, losing carriers must not freeze the plan
      if (step.workers !== undefined && k.workers.length < step.workers && obs.tick < 3 * 60 * S) continue;
      if (step.tick !== undefined && obs.tick < step.tick) continue;
      const cost = k.unitDef(step.build)?.cost ?? k.bDef(step.build)?.cost ?? [0, 0];
      const reqs = k.unitDef(step.build)?.requires ?? k.bDef(step.build)?.requires ?? [];
      if (!k.requirementsMet(reqs)) continue;
      if (k.unitDef(step.build)) {
        // a single special unit (the dendritic cell): train it where it is made
        const at = k.buildings.find((b) => !b.growing && b.type === k.unitDef(step.build)!.producedAt && b.queue.length < 5);
        if (!at) continue;
        if (afford(cost) && k.freeSupply >= k.unitDef(step.build)!.supply) {
          out.push({ type: 'TRAIN', units: [], building: at.id, unit: step.build, count: 1 });
          st.pend[step.build] = obs.tick + PEND;
          spend(cost);
          k.supply -= k.unitDef(step.build)!.supply;
        } else reserve = holdFor(cost);
        break;
      }
      if (!afford(cost)) {
        reserve = holdFor(cost);
        break;
      }
      if (buildStep(st, k, step, out)) spend(cost);
      break;
    }
  }

  // money piling up with nothing to buy: one more production building (up to four)
  const first = planFor(obs.faction, lv).find((p) => (k.bDef(p.build)?.produces.length ?? 0) > 0)?.build;
  if (first && reserve[0] === 0 && money > 700 && lv.armyCap > 10_000 && k.done.has(first)) {
    const prods = k.buildings.filter((b) => (k.bDef(b.type)?.produces.length ?? 0) > 0 && k.bDef(b.type)?.role === 'production').length;
    if (prods < 4 && afford(k.bDef(first)!.cost) && (st.skip[first] ?? 0) <= obs.tick && buildNear(st, k, first, 'base', out) === 'ok') {
      spend(k.bDef(first)!.cost);
      st.note = 'עודף כסף: מבנה ייצור נוסף';
    }
  }

  // 5. expansion
  if (lv.expand && reserve[0] === 0) {
    const r = expansion(st, k, lv, afford, out);
    if (r === 'paid') spend(k.bDef(EXPANSION[obs.faction]!)!.cost);
    else if (r === 'saving') reserve = holdFor(k.bDef(EXPANSION[obs.faction]!)!.cost);
  }

  // 6. units with what is left over (workers first while there are too few)
  if (k.workers.length + workersComing < want && k.hqs.length > 0) {
    reserve[0] += workerCost[0];
    reserve[1] += workerCost[1];
  }
  money -= reserve[0];
  adv = Math.max(0, adv - reserve[1]);
  let armyValue = 0;
  for (const f of k.fighters) armyValue += k.value(f.type);
  for (const b of k.buildings) {
    if (armyValue >= lv.armyCap) break;
    if (b.growing) continue;
    const mix = MIX[b.type];
    if (!mix) continue;
    const key = String(b.id);
    let queued = b.queue.length;
    while (queued < lv.queue) {
      // the next unit of the cycle it can make and afford (one short of amino acids is skipped, not waited for)
      const start = st.mix[key] ?? 0;
      let picked = -1;
      // with amino acids or iron piling up, the first unit of the cycle that uses them goes first
      const surplus = adv >= 150;
      for (let pass = surplus ? 0 : 1; pass < 2 && picked < 0; pass++) {
        for (let j = 0; j < mix.length; j++) {
          const u = k.unitDef(mix[(start + j) % mix.length]!)!;
          if (pass === 0 && u.cost[1] === 0) continue;
          if (!k.requirementsMet(u.requires) || !afford(u.cost) || k.freeSupply < u.supply) continue;
          picked = (start + j) % mix.length;
          break;
        }
      }
      if (picked < 0) break;
      const u = k.unitDef(mix[picked]!)!;
      out.push({ type: 'TRAIN', units: [], building: b.id, unit: u.id, count: 1 });
      spend(u.cost);
      k.supply -= u.supply;
      st.mix[key] = picked + 1;
      queued++;
      armyValue += u.cost[0] + u.cost[1];
    }
  }
  // the White Line's monocytes grow into macrophages once there is a spleen (the scout stays a monocyte)
  if (obs.faction === 'wl' && k.done.has('bld_wl_spleen')) {
    const mac = k.unitDef('unit_wl_macrophage')!;
    const extra = mac.supply - k.unitDef('unit_wl_monocyte')!.supply;
    for (const m of k.units) {
      if (m.type !== 'unit_wl_monocyte' || m.id === st.scout || m.morphing || !afford(mac.cost) || k.supply < extra) continue;
      out.push({ type: 'DEPLOY', units: [m.id] });
      spend(mac.cost);
      k.supply -= extra;
    }
  }
  k.money = Math.max(0, money);
  k.adv = Math.max(0, adv);
}

function nearDropoff(k: Know, r: { x: number; y: number }, tiles: number): boolean {
  return k.dropoffs.some((d) => d2(d, r.x, r.y) <= (tiles * T) ** 2);
}

/** Idle workers go to work: the least crowded crystal near a dropoff, an extractor with room, then anything known. */
function gather(st: AiState, k: Know, out: Cmd[]): void {
  void st;
  const obs = k.obs;
  if (k.dropoffs.length === 0) return;
  const extractorIds = new Set(k.buildings.filter((b) => k.bDef(b.type)?.role === 'extractor').map((b) => b.id));
  // plenty of the second resource: carriers at the extractor go back to glucose (a margin each way, so they do not flip back and forth)
  const tooMuch = obs.advanced > 500;
  const enough = obs.advanced > 300;
  const idle = k.workers.filter((w) => !w.morphing && (w.order === 'idle' || (w.order === 'gather' && w.gathering === 0 && w.cargo === 0) || (tooMuch && w.order === 'gather' && extractorIds.has(w.gathering))));
  if (idle.length === 0) return;
  const crowd = new Map<number, number>();
  for (const w of k.workers) if (w.gathering !== 0 && !idle.includes(w)) crowd.set(w.gathering, (crowd.get(w.gathering) ?? 0) + 1);
  // crystals in sight now (a remembered one may be gone)
  const crystals = obs.resources.filter((r) => r.kind === 'glucose' && r.slots > 0 && r.stock > 0 && r.seen === obs.tick);
  const near = crystals.filter((r) => nearDropoff(k, r, 14));
  const extractors = obs.resources.filter((r) => r.stock === 0 && r.slots > 0 && k.buildings.some((b) => b.id === r.id && !b.growing));
  for (const w of idle) {
    let best: ObsResource | null = null;
    let bestScore = Infinity;
    const consider = (r: ObsResource, cap: number, bias: number) => {
      const c = crowd.get(r.id) ?? 0;
      if (c >= cap) return;
      const score = c * 1_000_000_000 + bias + d2(r, w.x, w.y) / 64;
      if (score < bestScore) {
        best = r;
        bestScore = score;
      }
    };
    if (!enough) for (const r of extractors) consider(r, 3, -400_000_000);
    for (const r of near) consider(r, 2, 0);
    if (!best) for (const r of near) consider(r, 3, 0);
    if (!best) for (const r of crystals) consider(r, 2, 0);
    if (!best) continue;
    const r = best as ObsResource;
    crowd.set(r.id, (crowd.get(r.id) ?? 0) + 1);
    if (r.id === w.gathering) continue; // already there
    out.push({ type: 'GATHER', units: [w.id], target: r.id });
  }
}

/** Idle platelets help whatever is growing. */
function platelets(k: Know, out: Cmd[]): void {
  const growing = k.buildings.filter((b) => b.growing);
  if (growing.length === 0) return;
  for (const u of k.units) {
    if (k.unitDef(u.type)?.role !== 'builder' || u.order !== 'idle') continue;
    let best = growing[0]!;
    for (const b of growing) if (d2(b, u.x, u.y) < d2(best, u.x, u.y)) best = b;
    out.push({ type: 'ASSIST_BUILD', units: [u.id], target: best.id });
  }
}

/** A plan step for a building: on a deposit, at the front, or near the base. */
function buildStep(st: AiState, k: Know, step: PlanStep, out: Cmd[]): boolean {
  const r = buildNear(st, k, step.build, step.at ?? 'base', out);
  if (r === 'no_site') {
    const f = (st.fails[step.build] ?? 0) + 1;
    st.fails[step.build] = f;
    st.skip[step.build] = k.obs.tick + Math.min(60 * S, 10 * S * f);
  }
  return r === 'ok';
}

function buildNear(st: AiState, k: Know, type: string, at: 'base' | 'front' | 'resource' | 'mine', out: Cmd[]): 'ok' | 'busy' | 'no_site' {
  let site: [number, number] | null = null;
  if (at === 'resource') site = depositSite(k, type);
  else if (at === 'mine') {
    // between the main field and the base, where raiders come for the carriers
    const field = k.obs.resources.filter((r) => r.kind === 'glucose' && r.slots > 0 && nearDropoff(k, r, 12));
    const [fx, fy] = field.length > 0 ? centroid(field) : k.home;
    const [dx, dy] = towards([fx, fy], k.home, 3 * T);
    site = findSite(st, k, type, fx + dx, fy + dy, 8, true);
  } else {
    const off = at === 'front' ? towards(k.home, k.enemyStart, 8 * T) : towards(k.home, k.enemyStart, 3 * T);
    site = findSite(st, k, type, k.home[0] + off[0], k.home[1] + off[1], 13, true);
  }
  if (!site) return 'no_site';
  return orderBuilding(st, k, type, site, out) ? 'ok' : 'busy';
}

/**
 * Orders a building at a site. The White Line orders at the lymph node and places it on a
 * later thought (placeOrders); the Colony sends a feeder.
 */
function orderBuilding(st: AiState, k: Know, type: string, site: [number, number], out: Cmd[]): boolean {
  const obs = k.obs;
  if (obs.faction === 'wl') {
    const hq = k.buildings.find((b) => !b.growing && b.type === k.svc.catalog.factions.get('wl')!.hq && b.buildOrder === '');
    if (!hq || (st.pend['order'] ?? 0) > obs.tick) return false;
    out.push({ type: 'QUEUE_BUILD', units: [], building: hq.id, build: type });
    out.push({ type: 'PLACE_BUILD', units: [], building: hq.id, tx: site[0], ty: site[1] });
    st.pend['order'] = obs.tick + PEND;
    st.pend[type] = obs.tick + PEND;
    return true;
  }
  // the feeder nearest the site that is not carrying a load (or any, failing that)
  const [cx, cy] = [site[0] * T + T, site[1] * T + T];
  const free = k.workers.filter((w) => w.job === '' && !w.morphing);
  if (free.length === 0) return false;
  const pick = (list: ObsOwn[]) => list.reduce<ObsOwn | null>((b, w) => (!b || d2(w, cx, cy) < d2(b, cx, cy) ? w : b), null);
  const f = pick(free.filter((w) => w.cargo === 0)) ?? pick(free)!;
  out.push({ type: 'BUILD_AT', units: [f.id], build: type, tx: site[0], ty: site[1] });
  st.pend[type] = obs.tick + PEND;
  return true;
}

/** A lymph node still holding an order (its placement was refused): a new site, or the order cancelled. */
function placeOrders(st: AiState, k: Know, out: Cmd[]): void {
  if ((st.pend['order'] ?? 0) > k.obs.tick) return;
  for (const hq of k.buildings) {
    if (hq.buildOrder === '') continue;
    const type = hq.buildOrder;
    const key = `place:${type}`;
    const f = (st.fails[key] ?? 0) + 1;
    st.fails[key] = f;
    const def = k.bDef(type)!;
    let site: [number, number] | null = null;
    if (f <= 4) {
      if (def.placement === 'resource') site = depositSite(k, type);
      else if (def.placement === 'builder') site = st.expand ? [st.expand.tx, st.expand.ty] : null;
      else site = findSite(st, k, type, k.home[0], k.home[1], 15, true);
    }
    if (site && def.placement !== 'builder') {
      out.push({ type: 'PLACE_BUILD', units: [], building: hq.id, tx: site[0], ty: site[1] });
      st.pend['order'] = k.obs.tick + PEND;
    } else if (!site || f > 6) {
      out.push({ type: 'CANCEL', units: [], building: hq.id, what: 'order', index: 0 });
      st.fails[key] = 0;
      st.skip[type] = k.obs.tick + 30 * S;
      st.pend['order'] = k.obs.tick + PEND;
    }
  }
}

/** A free deposit of the extractor's kind near one of our dropoffs: its top-left tile. */
function depositSite(k: Know, type: string): [number, number] | null {
  const kind = k.bDef(type)!.onResource;
  let best: ObsResource | null = null;
  for (const r of k.obs.resources) {
    if (r.kind !== kind || r.slots !== 0 || r.link !== 0 || r.stock <= 0 || !nearDropoff(k, r, 16)) continue;
    if (!best || d2(r, k.home[0], k.home[1]) < d2(best, k.home[0], k.home[1])) best = r;
  }
  if (!best) return null;
  return k.svc.place(type, best.tx, best.ty) === null ? [best.tx, best.ty] : null;
}

/**
 * A site for a building near (x, y): rings outwards, two tiles of open ground left around
 * every building (three around the main building) and two around resources, so carriers and
 * large bodies (two tiles wide) still get through.
 */
function findSite(st: AiState, k: Know, type: string, x: number, y: number, maxR: number, lanes: boolean): [number, number] | null {
  const obs = k.obs;
  const [fw, fh] = k.bDef(type)!.footprint;
  const w = obs.mapW;
  const busy = new Uint8Array(obs.mapW * obs.mapH);
  const mark = (tx: number, ty: number, fw2: number, fh2: number, pad: number) => {
    for (let yy = ty - pad; yy < ty + fh2 + pad; yy++) for (let xx = tx - pad; xx < tx + fw2 + pad; xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < obs.mapH) busy[yy * w + xx] = 1;
  };
  if (lanes) {
    for (const b of k.buildings) mark(b.tx, b.ty, b.fw, b.fh, k.bDef(b.type)?.role === 'hq' ? 3 : 2);
    for (const r of obs.resources) mark(r.tx, r.ty, r.fw, r.fh, r.kind === 'glucose' ? 2 : 1);
  }
  const cx = Math.floor(x / T);
  const cy = Math.floor(y / T);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx - Math.floor(fw / 2);
        const ty = cy + dy - Math.floor(fh / 2);
        if (tx < 1 || ty < 1 || tx + fw >= obs.mapW || ty + fh >= obs.mapH) continue;
        if (st.bad.includes(`${type}@${tx},${ty}`)) continue;
        let clear = true;
        for (let yy = ty; yy < ty + fh && clear; yy++) for (let xx = tx; xx < tx + fw && clear; xx++) if (busy[yy * w + xx]) clear = false;
        if (!clear) continue;
        if (k.svc.place(type, tx, ty) !== null) continue;
        return [tx, ty];
      }
    }
  }
  return null;
}

/**
 * Expansion to the nearest known field without a dropoff of ours or an enemy building:
 * the Colony sends a feeder to become a core there; the White Line sends platelets and
 * places an outpost where they stand. Gives up on a field after three failures.
 */
function expansion(st: AiState, k: Know, lv: Level, afford: (c: [number, number]) => boolean, out: Cmd[]): 'none' | 'paid' | 'saving' {
  const obs = k.obs;
  const type = EXPANSION[obs.faction]!;
  const def = k.bDef(type)!;
  const x = st.expand;
  if (x) {
    const u = k.units.find((e) => e.id === x.unit);
    const built = k.buildings.some((b) => b.type === type && Math.abs(b.tx - x.tx) <= 2 && Math.abs(b.ty - x.ty) <= 2);
    if (built) {
      st.expand = null;
      st.note = 'התרחב לשדה חדש';
      return 'none';
    }
    const failed = (reason: string) => {
      x.tries++;
      st.bad.push(`${type}@${x.tx},${x.ty}`);
      if (st.bad.length > 40) st.bad.shift();
      st.note = `התרחבות נכשלה (${reason})`;
      if (x.tries >= 3) {
        st.badFields.push(x.field);
        st.expand = null;
      } else {
        const site = expansionSite(st, k, x.field);
        if (site) {
          x.tx = site[0];
          x.ty = site[1];
          x.unit = 0;
          x.since = obs.tick;
        } else {
          st.badFields.push(x.field);
          st.expand = null;
        }
      }
    };
    if (obs.tick - x.since > 90 * S) {
      failed('זמן');
      return 'none';
    }
    if (obs.faction === 'col') {
      if (x.unit === 0) {
        if (!afford(def.cost)) return 'saving';
        if (!orderBuilding(st, k, type, [x.tx, x.ty], out)) return 'none';
        const f = out[out.length - 1]!;
        x.unit = f.units[0] ?? 0;
        return 'paid';
      }
      if (!u) failed('הנשא מת');
      else if (u.job !== 'build_at' && (st.pend[type] ?? 0) <= obs.tick) failed('האתר נחסם');
      return 'none';
    }
    // the White Line: platelets to the site, then an outpost where they stand
    if (x.unit === 0 || !u) {
      const p = k.units.find((e) => k.unitDef(e.type)?.role === 'builder' && e.order !== 'job');
      if (!p) {
        if (k.count('unit_wl_platelets', st) === 0) {
          const marrow = k.buildings.find((b) => !b.growing && b.type === 'bld_wl_marrow');
          const pc = k.unitDef('unit_wl_platelets')!.cost;
          if (marrow && afford(pc) && k.supply >= 1) {
            k.supply -= 1;
            out.push({ type: 'TRAIN', units: [], building: marrow.id, unit: 'unit_wl_platelets', count: 1 });
            st.pend['unit_wl_platelets'] = obs.tick + PEND;
          }
        }
        return 'none';
      }
      x.unit = p.id;
    }
    const pl = k.units.find((e) => e.id === x.unit);
    if (!pl) return 'none';
    const [sx, sy] = [(x.tx + 1) * T + T / 2, (x.ty + def.footprint[1]) * T + T / 2];
    if (d2(pl, sx, sy) > (2 * T) ** 2) {
      if (pl.order === 'idle') out.push({ type: 'MOVE', units: [pl.id], x: sx, y: sy });
      return 'none';
    }
    const hq = k.buildings.find((b) => b.type === k.svc.catalog.factions.get('wl')!.hq && !b.growing);
    if (!hq || hq.buildOrder !== '' || (st.pend['order'] ?? 0) > obs.tick) return 'none';
    if (!afford(def.cost)) return 'saving';
    if (k.svc.place(type, x.tx, x.ty) !== null) {
      failed('האתר נחסם');
      return 'none';
    }
    out.push({ type: 'QUEUE_BUILD', units: [], building: hq.id, build: type });
    out.push({ type: 'PLACE_BUILD', units: [], building: hq.id, tx: x.tx, ty: x.ty });
    st.pend['order'] = obs.tick + PEND;
    st.pend[type] = obs.tick + PEND;
    return 'paid';
  }
  // start one? (a core put up beside the base for room does not count as an expansion)
  const away = k.buildings.filter((b) => (b.type === type || k.bDef(b.type)?.role === 'hq') && d2(b, k.home[0], k.home[1]) > (16 * T) ** 2).length;
  if (away >= (lv.multi ? 2 : 1) || k.workers.length < 14 || obs.tick < 3 * 60 * S) return 'none';
  const field = pickField(st, k);
  if (field === 0) return 'none';
  const site = expansionSite(st, k, field);
  if (!site) {
    st.badFields.push(field);
    return 'none';
  }
  st.expand = { field, tx: site[0], ty: site[1], unit: 0, tries: 0, since: obs.tick };
  st.note = `מתכנן התרחבות לשדה ${field}`;
  return 'none';
}

function pickField(st: AiState, k: Know): number {
  const fields = new Map<number, ObsResource[]>();
  for (const r of k.obs.resources) {
    if (r.kind !== 'glucose' || r.field === 0 || r.stock <= 0 || st.badFields.includes(r.field)) continue;
    const list = fields.get(r.field);
    if (list) list.push(r);
    else fields.set(r.field, [r]);
  }
  let best = 0;
  let bd = Infinity;
  for (const [f, list] of [...fields.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.some((r) => nearDropoff(k, r, 12))) continue;
    const [cx, cy] = centroid(list);
    if (k.known.some((e) => e.building && d2(e, cx, cy) <= (14 * T) ** 2)) continue;
    const d = (cx - k.home[0]) ** 2 + (cy - k.home[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

function expansionSite(st: AiState, k: Know, field: number): [number, number] | null {
  const list = k.obs.resources.filter((r) => r.field === field && r.stock > 0);
  if (list.length === 0) return null;
  const [cx, cy] = centroid(list);
  const type = EXPANSION[k.obs.faction]!;
  // near the field, on the side towards home
  const [dx, dy] = towards([cx, cy], k.home, 4 * T);
  const [x, y] = clampPoint(k.obs, cx + dx, cy + dy);
  const def = k.bDef(type)!;
  if (def.placement === 'builder') {
    // no platelets there yet: check the ground only, the outpost goes where they will stand
    return findSite(st, k, 'bld_wl_capillary', x, y, 6, true);
  }
  return findSite(st, k, type, x, y, 8, true);
}

// ---------------------------------------------------------------- army

function army(st: AiState, k: Know, lv: Level, out: Cmd[]): void {
  const obs = k.obs;
  const alive = new Set(k.units.map((u) => u.id));
  if (st.attack) st.attack.units = st.attack.units.filter((id) => alive.has(id));
  if (st.raid) st.raid.units = st.raid.units.filter((id) => alive.has(id));
  if (st.scout !== 0 && !alive.has(st.scout)) st.scout = 0;

  scouting(st, k, lv, out);
  sampling(st, k, out);

  // defence: enemies near our buildings
  const threats = obs.enemies.filter((e) => k.buildings.some((b) => d2(b, e.x, e.y) <= (BASE_RADIUS * T) ** 2));
  if (threats.length === 0) st.threatSince = -1;
  else if (st.threatSince < 0) st.threatSince = obs.tick;
  const busy = new Set<number>([...(st.attack?.units ?? []), ...(st.raid?.units ?? [])]);
  const homeArmy = k.fighters.filter((f) => !busy.has(f.id));
  if (threats.length > 0 && obs.tick - st.threatSince >= lv.react) {
    let tv = 0;
    for (const e of threats) tv += k.armed(e) ? k.value(e.type) : 10;
    const [tx, ty] = centroid(threats);
    let defenders = homeArmy;
    if (tv <= 20) {
      // a lone scout or worker: a few go, not the whole army
      defenders = [...homeArmy].sort((a, b) => d2(a, tx, ty) - d2(b, tx, ty)).slice(0, 3);
    } else if (st.attack && st.attack.units.length > 0) {
      // a real attack on the base while the wave is out: it comes back if the base is outmatched
      let hv = 0;
      for (const f of homeArmy) hv += k.value(f.type);
      if (hv < tv) {
        defenders = [...homeArmy, ...k.fighters.filter((f) => st.attack!.units.includes(f.id))];
        st.attack = null;
        st.mode = 'build';
        st.note = 'הגל חוזר להגן על הבסיס';
      }
    }
    const go = defenders.filter((f) => f.order !== 'attack' && !(f.order === 'amove' && d2(f, tx, ty) < (10 * T) ** 2));
    if (go.length > 0) out.push({ type: 'ATTACK_MOVE', units: ids(go), x: tx, y: ty });
    // carriers next to the fight keep working; the sim's own target choice handles the rest
  } else {
    // home army waits at the rally point; Colony fighters split while they wait
    const stray = homeArmy.filter((f) => f.order === 'idle' && d2(f, k.rally[0], k.rally[1]) > (5 * T) ** 2);
    if (stray.length > 0) out.push({ type: 'MOVE', units: ids(stray), x: k.rally[0], y: k.rally[1] });
    if (obs.faction === 'col' && lv.splits > 0 && st.mode === 'build') splitting(st, k, lv, homeArmy, out);
  }

  if (st.attack) wave(st, k, lv, st.attack, out);
  raids(st, k, lv, out);
}

function wave(st: AiState, k: Know, lv: Level, sq: Squad, out: Cmd[]): void {
  const obs = k.obs;
  const members = k.fighters.filter((f) => sq.units.includes(f.id));
  if (members.length === 0) {
    st.attack = null;
    st.mode = 'build';
    return;
  }
  const hp = members.reduce((s, f) => s + f.hp, 0);
  const [mx, my] = centroid(members);
  // losing: back home (the easy AI fights to the end)
  if (lv.retreat && hp * 100 < sq.hp0 * 35) {
    let near = 0;
    for (const e of obs.enemies) if (k.armed(e) && d2(e, mx, my) <= (12 * T) ** 2) near += k.value(e.type);
    let ours = 0;
    for (const f of members) ours += k.value(f.type);
    if (near > ours) {
      out.push({ type: 'MOVE', units: ids(members), x: k.rally[0], y: k.rally[1] });
      st.attack = null;
      st.mode = 'build';
      st.note = 'נסיגה: הגל מפסיד';
      return;
    }
  }
  // the target: the nearest enemy building known; on arrival with nothing left there, the next
  const [tx, ty] = attackPoint(k, [mx, my]);
  const moved = tx !== sq.x || ty !== sq.y;
  const idle = members.filter((f) => f.order === 'idle' || f.order === 'hold');
  sq.x = tx;
  sq.y = ty;
  const send = moved || sq.told < 0 ? members.filter((f) => f.order !== 'attack') : idle;
  if (send.length > 0) {
    out.push({ type: 'ATTACK_MOVE', units: ids(send), x: tx, y: ty });
    sq.told = obs.tick;
  }
  // stragglers that just came out of production join the wave (hard)
  if (lv.multi) {
    const fresh = k.fighters.filter((f) => !sq.units.includes(f.id) && !inSquad(st.raid, f.id) && f.order === 'idle' && d2(f, k.rally[0], k.rally[1]) <= (6 * T) ** 2);
    if (fresh.length >= 4) {
      sq.units.push(...ids(fresh));
      sq.hp0 += fresh.reduce((s, f) => s + f.hp, 0);
      out.push({ type: 'ATTACK_MOVE', units: ids(fresh), x: tx, y: ty });
    }
  }
}

/** The Colony's raids: fast flagellates against the enemy's carriers, gone when an answer comes. */
function raids(st: AiState, k: Know, lv: Level, out: Cmd[]): void {
  const obs = k.obs;
  if (!lv.raid || obs.faction !== 'col') return;
  if (st.raid) {
    const sq = st.raid;
    const members = k.fighters.filter((f) => sq.units.includes(f.id));
    if (members.length === 0) {
      st.raid = null;
      st.raidAt = obs.tick + 60 * S;
      return;
    }
    const hp = members.reduce((s, f) => s + f.hp, 0);
    const [mx, my] = centroid(members);
    let answer = 0;
    for (const e of obs.enemies) if (!e.building && k.armed(e) && d2(e, mx, my) <= (8 * T) ** 2) answer += k.value(e.type);
    let ours = 0;
    for (const f of members) ours += k.value(f.type);
    if (hp * 2 < sq.hp0 || answer > ours || obs.tick - sq.since > 60 * S) {
      out.push({ type: 'MOVE', units: ids(members), x: k.rally[0], y: k.rally[1] });
      st.raid = null;
      st.raidAt = obs.tick + 45 * S;
      st.note = 'הפשיטה חוזרת';
      return;
    }
    // workers in sight: bite them; otherwise on to the mining field
    const prey = obs.enemies.filter((e) => !e.building && k.unitDef(e.type)?.role === 'worker' && d2(e, mx, my) <= (9 * T) ** 2);
    if (prey.length > 0) {
      const target = prey.reduce((b, e) => (d2(e, mx, my) < d2(b, mx, my) ? e : b));
      const free = members.filter((f) => f.order !== 'attack');
      if (free.length > 0) out.push({ type: 'ATTACK', units: ids(free), target: target.id });
    } else if (members.some((f) => f.order === 'idle')) {
      out.push({ type: 'MOVE', units: ids(members), x: sq.x, y: sq.y });
    }
    return;
  }
  if (obs.tick < st.raidAt || (st.mode === 'attack' && !lv.multi)) return;
  const fast = k.fighters.filter((f) => f.type === 'unit_col_flagellate' && f.order === 'idle' && !inSquad(st.attack, f.id));
  if (fast.length < 2) return;
  const group = fast.slice(0, 4);
  // the enemy's mining: crystals it knows near the enemy's start, else the start itself
  const theirs = obs.resources.filter((r) => r.kind === 'glucose' && d2(r, k.enemyStart[0], k.enemyStart[1]) <= (12 * T) ** 2);
  const [px, py] = theirs.length > 0 ? centroid(theirs) : k.enemyStart;
  st.raid = { units: ids(group), x: px, y: py, hp0: group.reduce((s, f) => s + f.hp, 0), since: obs.tick, told: obs.tick };
  out.push({ type: 'MOVE', units: ids(group), x: px, y: py });
  st.note = `פשיטה על הנשאים (${group.length})`;
}

/** The Colony splits fighters waiting on its biofilm, with money to spare. */
function splitting(st: AiState, k: Know, lv: Level, homeArmy: ObsOwn[], out: Cmd[]): void {
  let money = k.money - 150; // keeps something for the plan
  let free = k.supply - 2;
  const ready: number[] = [];
  for (const f of homeArmy) {
    if (ready.length >= lv.splits) break;
    if (f.order !== 'idle' || f.morphing || f.calm < 60) continue;
    const u = k.unitDef(f.type)!;
    if (money < u.cost[0] || free < u.supply) continue;
    // the sim checks it stands on its own biofilm; the base is all biofilm, the rally point mostly
    if (d2(f, k.home[0], k.home[1]) > (9 * T) ** 2) continue;
    money -= u.cost[0];
    free -= u.supply;
    ready.push(f.id);
  }
  if (ready.length > 0) out.push({ type: 'SPLIT', units: ready });
  k.money = Math.max(0, money + 150);
  k.supply = free + 2;
  void st;
}

/** The first fighter goes round the map once: our side, the middle, the enemy's start, back. */
function scouting(st: AiState, k: Know, lv: Level, out: Cmd[]): void {
  const obs = k.obs;
  if (!lv.scout) return;
  if (st.scout === 0 && st.scoutStep === 0) {
    const s = k.units.find((u) => k.unitDef(u.type)?.role === 'scout' && u.order === 'idle');
    if (!s) return;
    st.scout = s.id;
  }
  if (st.scout === 0) return;
  const s = k.units.find((u) => u.id === st.scout);
  if (!s) {
    st.scout = 0;
    st.scoutStep = 99;
    return;
  }
  if (s.order !== 'idle') return;
  const hx = k.home[0];
  const route: [number, number][] = [
    [hx, 5 * T],
    [Math.trunc((obs.mapW * T) / 2), 6 * T],
    k.enemyStart,
    [Math.trunc((obs.mapW * T) / 2), (obs.mapH - 6) * T],
    k.rally,
  ];
  if (st.scoutStep >= route.length) {
    st.scout = 0; // done: it joins the army
    st.scoutStep = 99;
    return;
  }
  const [x, y] = clampPoint(obs, ...route[st.scoutStep]!);
  st.scoutStep++;
  out.push({ type: 'MOVE', units: [s.id], x, y });
}

/** A dendritic cell samples the first enemy it can reach; until an antigen opens, it keeps trying. */
function sampling(st: AiState, k: Know, out: Cmd[]): void {
  const obs = k.obs;
  if (obs.faction !== 'wl' || obs.antigens.length > 0) return;
  for (const d of k.units) {
    if (k.unitDef(d.type)?.role !== 'intel' || d.job !== '' || d.sample !== '') continue;
    let best: ObsEntity | null = null;
    for (const e of obs.enemies) {
      if (!best || d2(e, d.x, d.y) < d2(best, d.x, d.y)) best = e;
    }
    if (best && d2(best, d.x, d.y) <= (30 * T) ** 2) {
      out.push({ type: 'SAMPLE', units: [d.id], target: best.id });
      st.note = 'דנדריט דוגם';
    } else if (d.order === 'idle' && st.attack && st.attack.units.length > 0) {
      // behind the wave, where enemies will be
      const members = k.fighters.filter((f) => st.attack!.units.includes(f.id));
      const [mx, my] = centroid(members);
      const [bx, by] = towards([mx, my], k.home, 3 * T);
      out.push({ type: 'MOVE', units: [d.id], x: mx + bx, y: my + by });
    }
  }
}
