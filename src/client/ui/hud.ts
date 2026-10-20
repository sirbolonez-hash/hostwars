// The Hebrew interface around the battlefield: resources and income, the economy panel
// (fields, saturation, the warning before a field runs out), selection, the test lab, help
// and the performance line. Plain DOM over the canvas, so text, RTL and fonts just work.

import { entityById, type Entity } from '../../sim/core/world';
import { carryOf, isCrystal, isExtractor } from '../../sim/economy/gather';
import type { GatherStopReason } from '../../sim/economy/gather';
import type { RejectReason } from '../../sim/commands/commands';
import { PLACE_TEXT } from '../input/placement';
import type { Game } from '../game';
import type { Controls } from '../input/controls';
import type { WorldView } from '../render/worldView';
import { FAMILY_NAME, KIND_NAME, nameOf } from './names';
import { PLACE_TEXT as PLACE } from '../input/placement';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('he-IL');

/** Warn this many seconds before a field is expected to run out. */
const WARN_SECONDS = 90;
/** Stock samples kept per field (one a second) to estimate how fast it is worked. */
const SAMPLE_WINDOW = 30;

/** The test lab's army for each faction: unit, count, rows from the spawn point. */
const ARMY: Record<string, [string, number, number][]> = {
  wl: [['unit_wl_neutrophil', 16, 0], ['unit_wl_macrophage', 6, -4], ['unit_wl_eosinophil', 6, 4]],
  col: [['unit_col_coccus', 16, 0], ['unit_col_flagellate', 6, -4], ['unit_col_strep', 4, 4]],
};

const STOP_TEXT: Record<GatherStopReason, string> = {
  depleted: 'הגבישים בסביבה נגמרו',
  no_dropoff: 'אין לאן לפרוק — המטען נשאר אצל הנשאים עד שיהיה מבנה פריקה',
  path_blocked: 'לא נמצאה דרך אל המשאב',
  no_extractor: 'המשאבה נהרסה',
};

/** Why an order of mine was refused, in words that never reveal what is hidden. */
const REJECT_TEXT: Partial<Record<RejectReason, string>> = {
  ...PLACE_TEXT,
  no_resources: 'אין מספיק משאבים',
  supply_capped: 'אין מספיק אספקה — בנו צומת נימים',
  queue_full: 'התור מלא',
  requirements: 'חסר מבנה דרוש',
  not_ready: 'המבנה עדיין בצמיחה',
  no_order: 'אין בנייה שמחכה להצבה',
  nothing_to_do: 'אין כאן מה לעשות',
  no_builders: 'רק טסיות בונות ומתקנות',
  no_extractor: 'צריך קודם מבנה כרייה על המרבץ',
  depleted: 'המשאב התרוקן',
  cannot_deploy: 'אין מה להתמיר',
  cannot_split: 'חלוקה רק על ביופילם שלכם, אחרי כמה שניות בלי קרב',
  no_feeder: 'רק מזין הופך למבנה',
  no_dendritic: 'רק תא דנדריטי דוגם',
  no_family: 'אין מה לדגום כאן',
};

/** Why an AI gave up, for the end screen. */
const SURRENDER_TEXT: Record<string, string> = {
  no_economy: 'היריב נכנע: לא נשארו לו נשאים, כסף או צבא.',
  no_base: 'היריב נכנע: לא נשאר לו בסיס.',
};

export interface HudIcons {
  atp: string;
  /** the second resource of the player's faction (amino acids, iron) */
  advanced: string;
}

export interface DevSpots {
  /** where new units appear, sub-tiles */
  spawn: [number, number];
  /** a spot for a test depot near the far field */
  depot: [number, number];
}

export class Hud {
  private fpsFrames = 0;
  private fpsAcc = 0;
  private fps = 0;
  private lastSelKey = '';
  private clock = 0;
  private readonly samples = new Map<number, number[]>();
  /** ATP banked per second for the last minute, to show income */
  private readonly incomeLog: number[] = [];
  private incomeAcc = 0;
  private tipUntil = 0;
  private attackedAt = -1e9;
  private endShown = false;
  private surrender = '';
  /** the player's faction and its second resource's name */
  private readonly faction: string;
  private readonly advName: string;

  constructor(
    private readonly game: Game,
    private readonly controls: Controls,
    private readonly view: WorldView,
    gpu: string,
    private readonly spots: DevSpots,
    private readonly icons: HudIcons,
  ) {
    $('gpu').textContent = gpu;
    this.faction = game.world.players[game.me - 1]!.faction;
    this.advName = this.faction === 'wl' ? 'אמינו' : 'ברזל';
    controls.onChange = () => this.refreshSelection(true);
    const on = (id: string, f: () => void) => $(id).addEventListener('click', f);
    on('btn-workers', () => this.spawn(this.faction === 'wl' ? 'unit_wl_glut' : 'unit_col_feeder', 8, null, true));
    on('btn-kill', () => this.killSelected());
    on('btn-grant', () => {
      this.game.issue({ type: 'DEV_GRANT', units: [], basic: 1000, advanced: 200 });
      this.tip(`נוספו 1,000 ATP ו-200 ${this.advName}.`);
    });
    on('btn-army', () => {
      const [x, y] = this.spots.spawn;
      for (const [unit, n, dy] of ARMY[this.faction] ?? []) this.game.issue({ type: 'DEV_SPAWN', units: [], unit, count: n, x: x + 3 * 256, y: y + dy * 256 });
      this.tip('הצבא מוכן ליד הבסיס. סמנו אותו בגרירה, לחצו A ואז לחיצה ליד בסיס היריב.');
    });
    on('btn-enemy-army', () => {
      const foe = this.game.world.players.find((p) => p.id !== this.game.me)!;
      const hq = this.game.world.entities.find((e) => e.owner === foe.id && e.building);
      if (!hq) return;
      const dir = hq.x > this.game.world.mapW / 2 ? -1 : 1;
      for (const [unit, n, dy] of ARMY[foe.faction] ?? []) this.game.issueAs(foe.id, { type: 'DEV_SPAWN', units: [], unit, count: n, x: hq.x + dir * 6 * 256, y: hq.y + dy * 256 });
      this.tip('ליריב נוסף צבא ליד הבסיס שלו.');
    });
    on('btn-reveal', () => {
      view.fog.off = !view.fog.off;
      $('btn-reveal').setAttribute('aria-pressed', String(view.fog.off));
    });
    on('end-again', () => location.reload());
    on('end-stay', () => {
      $('end').hidden = true;
    });
    on('btn-help', () => {
      const h = $('help');
      h.hidden = !h.hidden;
    });
    on('btn-debug', () => {
      view.debugOn = !view.debugOn;
      this.refreshSelection(true);
    });
    on('btn-speed', () => {
      game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 4 : game.speed === 4 ? 0.5 : 1;
      $('btn-speed').textContent = `מהירות ×${game.speed}`;
    });
    on('btn-pause', () => {
      game.paused = !game.paused;
      $('btn-pause').textContent = game.paused ? 'המשך' : 'השהה';
    });
  }

  private tip(text: string, ms = 6000): void {
    $('tip').textContent = text;
    this.tipUntil = performance.now() + ms;
  }

  /** Spawns through the dev command, then selects the newcomers once they exist (and sets them mining). */
  private spawn(unit: string, count: number, at: [number, number] | null = null, mine = false): void {
    const [x, y] = at ?? this.spots.spawn;
    const before = this.game.world.nextId;
    this.game.issue({ type: 'DEV_SPAWN', units: [], unit, count, x, y });
    const wait = () => {
      if (this.game.world.nextId === before) {
        requestAnimationFrame(wait);
        return;
      }
      this.controls.selected.clear();
      this.controls.inspected = null;
      const fresh = this.game.world.entities.filter((e) => e.id >= before && e.type === unit);
      for (const e of fresh) this.controls.selected.add(e.id);
      this.refreshSelection(true);
      if (mine) {
        const home = this.homeCrystal();
        if (home) this.game.issue({ type: 'GATHER', units: fresh.map((e) => e.id), target: home.id });
        this.tip('הנשאים החדשים יצאו לשדה הבית. מעל השדה מופיע כמה עובדים בו מתוך המקסימום המועיל (2 לכל גביש).');
      }
    };
    requestAnimationFrame(wait);
  }

  /** Test lab: destroys what is inspected (a building, a crystal) or the selected units. */
  private killSelected(): void {
    const targets = this.controls.inspected !== null ? [this.controls.inspected] : this.controls.liveSelection();
    if (targets.length === 0) {
      this.tip('קודם בחרו משהו להרוס: לחיצה על מבנה או גביש, או בחירת יחידות.');
      return;
    }
    this.game.issue({ type: 'DEV_KILL', units: [], targets });
    this.controls.inspected = null;
    this.controls.selected.clear();
    this.refreshSelection(true);
  }

  private homeCrystal(): Entity | undefined {
    const hq = this.game.world.entities.find((e) => e.owner === this.game.me && this.game.ctx.catalog.buildings.get(e.type)?.role === 'hq');
    let best: Entity | undefined;
    let bd = Infinity;
    for (const e of this.game.world.entities) {
      if (!isCrystal(this.game.ctx, e) || !e.res || e.res.stock === 0) continue;
      const d = hq ? Math.hypot(e.x - hq.x, e.y - hq.y) : 0;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private refreshSelection(force = false): void {
    const ids = this.controls.liveSelection();
    let insp = this.controls.inspected !== null ? entityById(this.game.world, this.controls.inspected) : undefined;
    // an enemy building that slips out of sight is no longer described: nothing hidden leaks
    if (insp && insp.owner !== 0 && insp.owner !== this.game.me && !this.view.sees(this.game.world, insp)) insp = undefined;
    if (this.controls.inspected !== null && !insp) this.controls.inspected = null;
    const key = ids.join(',') + '|' + this.view.debugOn + '|' + (insp ? `${insp.id}:${insp.res?.stock ?? insp.hp}` : '');
    this.view.inspected = this.controls.inspected;
    if (!force && key === this.lastSelKey) return;
    this.lastSelKey = key;
    const sel = $('selection');
    if (insp) sel.textContent = this.describe(insp);
    else if (ids.length === 0) sel.textContent = 'לא נבחרו יחידות';
    else {
      const counts = new Map<string, number>();
      let cargo = 0;
      for (const id of ids) {
        const e = entityById(this.game.world, id);
        if (!e) continue;
        counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        cargo += e.cargo;
      }
      sel.textContent = `${ids.length} נבחרו · ` + [...counts].map(([t, n]) => `${nameOf(t)} ×${n}`).join(' · ') + (cargo ? ` · נושאים ${cargo}` : '');
    }
    $('btn-debug').setAttribute('aria-pressed', String(this.view.debugOn));
  }

  /** A line about a building or resource. */
  private describe(e: Entity): string {
    const { world, ctx } = this.game;
    const workers = world.entities.filter((c) => c.gather?.target === e.id && c.owner === this.game.me).length;
    const rd = ctx.catalog.resources.get(e.type);
    if (rd && e.res) {
      if (rd.slots === 0) {
        const ext = e.res.link ? entityById(world, e.res.link) : undefined;
        return `${nameOf(e.type)} · נותרו ${fmt(e.res.stock)} מתוך ${fmt(rd.stock)} · ${ext ? `עליו ${nameOf(ext.type)}` : 'צריך מבנה כרייה עליו'}`;
      }
      return `${nameOf(e.type)} · נותרו ${fmt(e.res.stock)} מתוך ${fmt(rd.stock)} · ${workers} נשאים עליו (עמדת עבודה אחת)`;
    }
    if (isExtractor(ctx, e) && e.res) {
      const dep = e.res.link ? entityById(world, e.res.link) : undefined;
      const busy = e.res.slots.filter((s) => s !== 0).length;
      return `${nameOf(e.type)} · ${dep?.res ? `נותרו ${fmt(dep.res.stock)}` : 'המרבץ התרוקן'} · ${busy}/${e.res.slots.length} עמדות עובדות · ${workers} נשאים`;
    }
    const bd = ctx.catalog.buildings.get(e.type);
    const extra = bd?.dropoff ? ' · נקודת פריקה' : '';
    return `${nameOf(e.type)} · ${fmt(e.hp)}/${fmt(e.maxHp)}${extra}`;
  }

  /** Economy panel: my fields and extractors, saturation, and how long the stock will last. */
  private refreshEconomy(): void {
    const { world, ctx } = this.game;
    const me = this.game.me;
    const lines: string[] = [];
    const warnings: string[] = [];
    for (const f of ctx.map.fields) {
      const crystals = world.entities.filter((e) => e.res && e.res.field === f.id && isCrystal(ctx, e));
      const ids = new Set(crystals.map((c) => c.id));
      const workers = world.entities.filter((e) => e.owner === me && e.gather && ids.has(e.gather.target)).length;
      const stock = crystals.reduce((s, c) => s + c.res!.stock, 0);
      // stock samples, for the depletion estimate
      const hist = this.samples.get(f.id) ?? [];
      hist.push(stock);
      if (hist.length > SAMPLE_WINDOW) hist.shift();
      this.samples.set(f.id, hist);
      if (workers === 0) continue;
      const optimal = crystals.length * 2;
      const state = workers < crystals.length ? 'חלקית' : workers <= optimal ? 'טובה' : 'עודף נשאים';
      lines.push(`<div><b>${f.name}</b> · ${workers}/${optimal} נשאים (${state}) · ${fmt(stock)} ${KIND_NAME.glucose}</div>`);
      if (hist.length >= 10) {
        const rate = (hist[0]! - hist[hist.length - 1]!) / (hist.length - 1); // per second
        if (rate > 0 && stock > 0 && stock / rate < WARN_SECONDS) warnings.push(`${f.name} ייגמר בעוד כ-${Math.max(5, Math.round(stock / rate / 5) * 5)} שניות`);
      }
    }
    for (const e of world.entities) {
      if (e.owner !== me || !isExtractor(ctx, e) || !e.res) continue;
      const dep = e.res.link ? entityById(world, e.res.link) : undefined;
      const workers = world.entities.filter((c) => c.gather?.target === e.id).length;
      const kind = dep ? (ctx.catalog.resources.get(dep.type)?.kind ?? 'protein') : 'protein';
      lines.push(`<div><b>${nameOf(e.type)}</b> · ${workers}/${e.res.slots.length} נשאים · ${dep?.res ? fmt(dep.res.stock) : 0} ${KIND_NAME[kind]}</div>`);
    }
    const idle = world.entities.filter((e) => e.owner === me && carryOf(ctx, e) > 0 && !e.gather && !e.mv).length;
    if (idle) lines.push(`<div class="idle">${idle} נשאים בטלים</div>`);
    for (const w of warnings) lines.push(`<div class="warn">⚠ ${w}</div>`);
    $('eco-body').innerHTML = lines.length ? lines.join('') : '<div class="idle">אין נשאים בעבודה</div>';
  }

  update(dtMs: number): void {
    // events of this frame: income, and carriers that stopped and why
    const stops = new Map<GatherStopReason, number>();
    for (const ev of this.game.events) {
      if (ev.type === 'delivered' && ev.owner === this.game.me && ev.kind === 'glucose') this.incomeAcc += ev.amount;
      if (ev.type === 'gather_stopped') {
        const e = entityById(this.game.world, ev.entity);
        if (e && e.owner === this.game.me) stops.set(ev.reason, (stops.get(ev.reason) ?? 0) + 1);
      }
    }
    for (const [reason, n] of stops) this.tip(`${n === 1 ? 'נשא עצר' : `${n} נשאים עצרו`}: ${STOP_TEXT[reason]}`, 8000);
    for (const ev of this.game.events) {
      if (ev.type === 'rejected' && ev.rejection.player === this.game.me) this.tip(REJECT_TEXT[ev.rejection.reason] ?? 'הפקודה לא בוצעה', 4000);
      if (ev.type === 'exit_blocked' && ev.owner === this.game.me) {
        const b = entityById(this.game.world, ev.building);
        this.tip(`היציאה של ${b ? nameOf(b.type) : 'המבנה'} חסומה — היחידה מחכה למקום פנוי`, 8000);
      }
      if (ev.type === 'built' && ev.owner === this.game.me) {
        const b = entityById(this.game.world, ev.entity);
        if (b) this.tip(`${nameOf(b.type)} מוכן`, 4000);
      }
      if (ev.type === 'morphed' && ev.owner === this.game.me) this.tip('ההתמרה הושלמה', 3000);
      if (ev.type === 'split' && ev.owner === this.game.me) this.tip('החלוקה הושלמה: יחידה חדשה לידה', 3000);
      if (ev.type === 'became' && ev.owner === this.game.me) {
        const b = entityById(this.game.world, ev.building);
        this.tip(`המזין הפך ל${b ? nameOf(b.type) : 'מבנה'} — עכשיו הוא צומח`, 4000);
      }
      if (ev.type === 'build_failed' && ev.owner === this.game.me) this.tip(`המזין לא הצליח לבנות: ${PLACE[ev.reason as keyof typeof PLACE] ?? 'המקום כבר לא מתאים'} (הכסף הוחזר)`, 6000);
      if (ev.type === 'sampled' && ev.owner === this.game.me) this.tip(`נלקחה דגימה (${FAMILY_NAME[ev.family] ?? ev.family}) — התא הדנדריטי מביא אותה לצומת הלימפה`, 6000);
      if (ev.type === 'sample_delivered' && ev.owner === this.game.me) this.tip('הדגימה הגיעה לצומת הלימפה: 30 שניות עיבוד', 5000);
      if (ev.type === 'antigen_opened' && ev.owner === this.game.me) this.tip(`נפתח אנטיגן: ${FAMILY_NAME[ev.family] ?? ev.family}! אפשר לבנות את אקדמיית התימוס ואת מרכז הנבט, ותאים ספציפיים יחזקו נגדו`, 9000);
      if (ev.type === 'sample_stopped' && ev.owner === this.game.me) this.tip(ev.reason === 'gone' ? 'הדגימה הופסקה: האויב נעלם מהעין' : 'אין צומת לימפה לקחת אליו את הדגימה', 5000);
      if (ev.type === 'surrendered' && ev.player !== this.game.me) this.surrender = SURRENDER_TEXT[ev.reason] ?? 'היריב נכנע.';
      // something of mine is hit: a warning, at most every 15 seconds
      if (ev.type === 'hit') {
        const t = entityById(this.game.world, ev.target);
        if (t && t.owner === this.game.me && performance.now() - this.attackedAt > 15000) {
          this.attackedAt = performance.now();
          this.tip(t.building ? `${nameOf(t.type)} מותקף!` : 'היחידות שלכם מותקפות!', 5000);
        }
      }
    }
    const out = this.game.world.outcome;
    // a mission ends on its own screen (MissionHud)
    if (out && !this.endShown && !this.game.world.mission) {
      this.endShown = true;
      const myTeam = this.game.world.players[this.game.me - 1]!.team;
      $('end-title').textContent = out.winnerTeam === 0 ? 'תיקו' : out.winnerTeam === myTeam ? 'ניצחון!' : 'הפסד';
      const won = this.faction === 'wl' ? 'כל המבנים החיוניים של הקולוניה הושמדו. הגוף בריא.' : 'השורה הלבנה קרסה. הקולוניה השתלטה על הרקמה.';
      $('end-text').textContent = out.winnerTeam === 0 ? 'שני הצדדים איבדו את המבנים החיוניים באותו רגע.' : out.winnerTeam === myTeam ? this.surrender || won : 'המבנים החיוניים שלכם הושמדו.';
      $('end').hidden = false;
    }
    if (this.tipUntil && performance.now() > this.tipUntil) {
      $('tip').textContent = '';
      this.tipUntil = 0;
    }

    this.clock += this.game.paused ? 0 : dtMs * this.game.speed;
    if (this.clock >= 1000) {
      this.clock -= 1000;
      this.incomeLog.push(this.incomeAcc);
      this.incomeAcc = 0;
      if (this.incomeLog.length > 60) this.incomeLog.shift();
      this.refreshEconomy();
    }

    this.fpsFrames++;
    this.fpsAcc += dtMs;
    if (this.fpsAcc >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsFrames = 0;
      this.fpsAcc = 0;
      const w = this.game.world;
      const p = w.players[this.game.me - 1]!;
      const base = w.entities.some((e) => e.owner === this.game.me && e.building);
      const perMin = this.incomeLog.length ? Math.round((this.incomeLog.reduce((s, v) => s + v, 0) * 60) / this.incomeLog.length) : 0;
      $('res').innerHTML =
        `<span class="r" title="ATP"><img src="${this.icons.atp}" alt="">ATP ${fmt(p.basic)}</span>` +
        `<span class="r" title="${this.advName}"><img src="${this.icons.advanced}" alt="">${this.advName} ${fmt(p.advanced)}</span>` +
        (base
          ? `<span class="r${p.supplyUsed > p.supplyCap ? ' over' : ''}" title="בשימוש / תקרה${p.supplyReserved ? ' (שמור בתורים)' : ''}">אספקה ${p.supplyUsed}${p.supplyReserved ? `+${p.supplyReserved}` : ''}/${p.supplyCap}</span>` +
            `<span class="r income">+${fmt(perMin)} ATP לדקה</span>`
          : '') +
        (this.faction === 'wl' && base ? `<span class="r" title="משפחות חיידקים שהגוף כבר מכיר">אנטיגנים: ${p.antigens.length ? p.antigens.map((f) => FAMILY_NAME[f] ?? f).join(', ') : 'אין — שלחו תא דנדריטי לדגום אויב'}</span>` : '');
      // a mission without a base (mission 1): no economy to show
      $('eco').hidden = !base;
      // the debug layer: what each AI decided last
      const notes = this.game.ais.map((a) => a.state.note).filter(Boolean);
      $('ai-note').textContent = notes.length ? `היריב: ${notes.join(' · ')}` : '';
      const st = [...this.game.simTimes].sort((a, b) => a - b);
      const p95 = st.length ? st[Math.floor(st.length * 0.95)]! : 0;
      const avg = st.length ? st.reduce((s, v) => s + v, 0) / st.length : 0;
      const exp = Math.max(0, ...this.game.pathCounts);
      const units = w.entities.filter((e) => !e.building).length;
      $('perf-line').textContent = `${this.fps.toFixed(0)} fps · tick ${avg.toFixed(2)} ms (p95 ${p95.toFixed(2)}) · ${units} units · path ${exp}/tick · queue ${w.pathQueue.length}`;
      this.refreshSelection();
    }
  }
}
