// A mission's interface: its objectives, the host's monitor (inflammation with its tiers,
// fever, pressure, pulse, tissue, a beating trace), what the speakers say, the alarm when the
// patient is in danger, and the end — with the mission's medical truth when it is won.
// Reads the world; sends nothing.

import type { MissionDef } from '../../sim/content/types';
import { feverOf, PRESSURE_SHOCK, SHOCK_TICKS, STORM_TICKS, tierOf, tissueOf } from '../../sim/host/host';
import type { Game } from '../game';
import type { WorldView } from '../render/worldView';
import { markFinished, SPEAKERS } from './menu';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const TIER = [
  { name: 'רגועה', colour: '#7ee081' },
  { name: 'פעילה', colour: '#ffc83d' },
  { name: 'סוערת', colour: '#ff8a3d' },
  { name: 'סערת ציטוקינים', colour: '#ff4d6d' },
];

const LOST: Record<string, string> = {
  tissue: 'הרקמה נהרסה: שלמות הרקמה ירדה מתחת למינימום של המשימה.',
  cytokine_storm: 'סערת ציטוקינים: הדלקת נשארה מעל 85 דקה שלמה, והגוף פגע בעצמו.',
  shock: 'הלם: לחץ הדם נשאר מתחת ל-50 דקה שלמה.',
  hero: 'גיבור נפל בקרב.',
  army: 'לא נשארו כוחות בשטח.',
  lymph: 'הזיהום הגיע לכלי הלימפה — ומשם לכל הגוף.',
  node: 'צומת הלימפה נפל.',
  time: 'הזמן נגמר לפני שכל היעדים הושגו.',
};

export class MissionHud {
  private objKey = '';
  private sayQueue: { speaker: string; text: string }[] = [];
  private sayUntil = 0;
  private clock = 0;
  private ended = false;
  private readonly ecg: CanvasRenderingContext2D;
  private trace: number[] = [];
  private phase = 0;

  constructor(
    private readonly game: Game,
    private readonly def: MissionDef,
    private readonly view: WorldView,
    private readonly next: MissionDef | null,
  ) {
    for (const id of ['objectives', 'monitor']) $(id).hidden = false;
    $('mission-title').textContent = `משימה ${def.number} · ${def.title}`;
    this.ecg = ($('ecg') as HTMLCanvasElement).getContext('2d')!;
    view.gates = def.gates;
    $('say').onclick = () => (this.sayUntil = 0);
  }

  update(dtMs: number): void {
    const w = this.game.world;
    for (const ev of this.game.events) {
      if (ev.type === 'mission_say') this.sayQueue.push({ speaker: ev.speaker, text: ev.text });
      // the wound closing (mission 1): a clot over its floor
      if (ev.type === 'objective' && ev.id === 'seal' && ev.state === 'done') this.view.effects.play('fx_clot_seal', 50 * 32, 30 * 32, 2.2);
    }
    this.renderObjectives();
    this.renderSay();
    this.clock += dtMs;
    if (this.clock >= 200) {
      this.clock = 0;
      this.renderMonitor();
    }
    this.drawEcg(dtMs);
    if (w.outcome && !this.ended) {
      this.ended = true;
      window.setTimeout(() => this.end(), 1200);
    }
  }

  private renderObjectives(): void {
    const m = this.game.world.mission;
    if (!m) return;
    const key = JSON.stringify(m.objectives);
    if (key === this.objKey) return;
    this.objKey = key;
    $('obj-list').innerHTML = this.def.objectives
      .filter((o) => m.objectives[o.id] !== 'hidden')
      .map((o) => {
        const st = m.objectives[o.id]!;
        const mark = st === 'done' ? '✓' : st === 'failed' ? '✗' : '○';
        return `<li class="${st}"><span>${mark}</span>${o.text}</li>`;
      })
      .join('');
  }

  private renderSay(): void {
    const now = performance.now();
    if (now < this.sayUntil) return;
    const next = this.sayQueue.shift();
    if (!next) {
      $('say').hidden = true;
      return;
    }
    const sp = SPEAKERS[next.speaker];
    ($('say-img') as HTMLImageElement).src = sp?.portrait ?? '';
    $('say-who').textContent = sp?.name ?? next.speaker;
    $('say-text').textContent = next.text;
    $('say').hidden = false;
    this.sayUntil = now + Math.max(5000, next.text.length * 65);
  }

  private renderMonitor(): void {
    const w = this.game.world;
    const h = w.host;
    if (!h) return;
    const infl = h.infl / 1000;
    const tier = tierOf(h.infl);
    const fever = feverOf(h.infl) / 10;
    const pressure = Math.round(h.pressure / 1000);
    const pulse = Math.round(72 + infl * 0.55 + Math.max(0, 85 - pressure) * 0.8);
    const tissue = tissueOf(w, this.game.ctx) / 10;
    const bar = $('infl-bar');
    bar.style.width = `${Math.min(100, infl)}%`;
    bar.style.background = TIER[tier]!.colour;
    $('infl-val').textContent = `${Math.round(infl)} · ${TIER[tier]!.name}`;
    $('m-fever').textContent = `${fever.toFixed(1)}°`;
    $('m-fever').className = fever >= 40 ? 'bad' : fever >= 38 ? 'warm' : '';
    $('m-bp').textContent = `${pressure}`;
    $('m-bp').className = pressure < 65 ? 'bad' : '';
    $('m-pulse').textContent = `${pulse}`;
    $('m-tissue').textContent = `${tissue.toFixed(0)}%`;
    $('m-tissue').className = tissue * 10 < this.def.host.tissueMin + 100 ? 'bad' : '';
    $('m-tissue-min').textContent = `(מינימום ${this.def.host.tissueMin / 10}%)`;
    // the alarms: a cytokine storm or shock counting down
    const alarm = $('alarm');
    if (h.stormSince >= 0) {
      alarm.textContent = `סערת ציטוקינים! ${Math.ceil((STORM_TICKS - (w.tick - h.stormSince)) / 20)} שניות להוריד את הדלקת מתחת ל-85 — עצרו את ההתקפה, תנו לה לרדת`;
      alarm.hidden = false;
    } else if (h.shockSince >= 0 && h.pressure < PRESSURE_SHOCK) {
      alarm.textContent = `הלם! ${Math.ceil((SHOCK_TICKS - (w.tick - h.shockSince)) / 20)} שניות — הלחץ מתחת ל-50`;
      alarm.hidden = false;
    } else alarm.hidden = true;
    this.phase = pulse;
  }

  /** A monitor trace: a beat every 60/pulse seconds, scrolling. */
  private drawEcg(dtMs: number): void {
    const c = this.ecg;
    const W = c.canvas.width;
    const H = c.canvas.height;
    const pulse = this.phase || 72;
    const period = 60000 / pulse;
    const t = performance.now() % period;
    const p = t / period;
    // the shape of one beat: flat, a small bump, the spike, a dip, a wave
    const y = p < 0.1 ? 0 : p < 0.15 ? 0.15 : p < 0.18 ? 0 : p < 0.2 ? -0.2 : p < 0.23 ? 1 : p < 0.26 ? -0.35 : p < 0.4 ? 0 : p < 0.5 ? 0.25 : 0;
    const steps = Math.max(1, Math.round(dtMs / 16));
    for (let k = 0; k < steps; k++) this.trace.push(y);
    while (this.trace.length > W / 2) this.trace.shift();
    c.clearRect(0, 0, W, H);
    c.strokeStyle = this.game.world.host && tierOf(this.game.world.host.infl) >= 2 ? '#ff6b6b' : '#5dff9b';
    c.lineWidth = 2;
    c.beginPath();
    this.trace.forEach((v, i) => {
      const x = i * 2;
      const yy = H * 0.6 - v * H * 0.5;
      if (i === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    });
    c.stroke();
  }

  private end(): void {
    const out = this.game.world.outcome!;
    const won = out.winnerTeam === this.game.world.players[this.game.me - 1]!.team;
    $('end-title').textContent = won ? 'המשימה הושלמה' : 'המשימה נכשלה';
    $('end-text').textContent = won ? 'המטופל בסדר — בינתיים.' : (LOST[out.reason] ?? 'המשימה נכשלה.');
    const truth = $('end-truth');
    truth.hidden = !won;
    if (won) {
      markFinished(this.def.id);
      $('truth-title').textContent = `אמת רפואית · ${this.def.truth.title}`;
      $('truth-text').textContent = this.def.truth.text;
    }
    const again = $('end-again');
    const nextBtn = $('end-next');
    nextBtn.hidden = !(won && this.next);
    nextBtn.onclick = () => {
      location.hash = `mission=${this.next!.id}`;
      location.reload();
    };
    again.textContent = won ? 'לתפריט' : 'נסו שוב';
    again.onclick = () => {
      location.hash = won ? '' : `mission=${this.def.id}`;
      location.reload();
    };
    $('end-stay').hidden = false;
    $('end').hidden = false;
  }
}
