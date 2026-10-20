// The command card: what the selected building or units can do, in Hebrew, with the reason
// written on every button that cannot be pressed right now. Buttons only send commands; the
// simulation decides. Reasons come from the simulation's own validation functions.

import { QUEUE_MAX, validateBuildingCmd, validateUnitJob } from '../../sim/build/production';
import type { Cmd, RejectReason } from '../../sim/commands/commands';
import { entityById, type Entity } from '../../sim/core/world';
import type { Game } from '../game';
import type { Controls } from '../input/controls';
import type { Placer } from '../input/placement';
import { nameOf } from './names';

const $ = (id: string) => document.getElementById(id)!;

const REASON: Partial<Record<RejectReason, string>> = {
  no_resources: 'אין מספיק משאבים',
  supply_capped: 'אין מספיק אספקה — בנו צומת נימים',
  queue_full: 'התור מלא',
  not_ready: 'המבנה עדיין בצמיחה',
  cannot_produce: 'לא כאן',
  requirements: 'חסר מבנה דרוש',
  cannot_deploy: 'אין מה להתמיר',
};

type Btn = { label: string; icon: string; cost: [number, number]; cmd: Cmd | null; reason: string | null; key: string; then?: () => void };

export class CommandCard {
  private key = '';
  /** after ordering a building: start placing it as soon as the order exists */
  private placeNext: { hq: number; type: string } | null = null;

  constructor(
    private readonly game: Game,
    private readonly controls: Controls,
    private readonly placer: Placer,
    private readonly iconOf: (id: string) => string,
  ) {
    $('cmd').addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!el || el.hasAttribute('disabled')) return;
      const act = this.actions[Number(el.dataset.i)];
      if (!act) return;
      if (act.cmd) {
        const cmd = act.cmd;
        // shift: five at once
        if (cmd.type === 'TRAIN' && (ev as MouseEvent).shiftKey) this.game.issue({ ...cmd, count: Math.min(QUEUE_MAX, 5) });
        else this.game.issue(cmd);
      }
      act.then?.();
    });
  }

  private actions: { cmd: Cmd | null; then?: () => void }[] = [];

  private reqText(reqs: string[]): string {
    const missing = reqs.filter((r) => !this.game.world.entities.some((e) => e.owner === this.game.me && e.type === r && e.build === null));
    return missing.length ? 'דורש: ' + missing.map((r) => (r.startsWith('antigen:') ? 'דגימת אנטיגן' : nameOf(r))).join(', ') : '';
  }

  private reason(r: RejectReason | null, reqs: string[] = []): string | null {
    if (r === null) return null;
    if (r === 'requirements') return this.reqText(reqs) || REASON.requirements!;
    return REASON[r] ?? 'לא אפשרי עכשיו';
  }

  /** Called every frame: keeps progress bars current, rebuilds the card when its content changes. */
  update(): void {
    const { world } = this.game;
    const me = this.game.me;
    // placement follows the order: begins when the ordered building exists, ends when it is placed
    if (this.placeNext) {
      const hq = entityById(world, this.placeNext.hq);
      if (hq?.buildOrder?.type === this.placeNext.type) {
        this.placer.start(this.placeNext.hq, this.placeNext.type);
        this.placeNext = null;
      }
    }
    if (this.placer.active) {
      const hq = this.placer.hq !== null ? entityById(world, this.placer.hq) : undefined;
      if (!hq || !hq.buildOrder) this.placer.cancel();
    }

    const b = this.controls.inspected !== null ? entityById(world, this.controls.inspected) : undefined;
    const mineB = b && b.owner === me && this.game.ctx.catalog.buildings.has(b.type) ? b : undefined;
    const units = this.controls.liveSelection().map((id) => entityById(world, id)).filter((e): e is Entity => e !== undefined);
    const p = world.players[me - 1]!;
    const key = [
      mineB ? `${mineB.id}|${mineB.build ? 'g' : 'c'}|${(mineB.queue ?? []).map((q) => q.unit + (q.started ? 's' : '') + (q.blocked ? 'b' : '')).join(',')}|${mineB.buildOrder?.type ?? ''}` : '',
      units.map((u) => u.id + u.type + (u.morph ? 'm' : '')).join(','),
      p.basic >= 0 ? Math.floor(p.basic / 5) : 0, p.advanced, p.supplyUsed, p.supplyReserved, p.supplyCap,
      world.entities.filter((e) => e.owner === me && e.building && !e.build).length,
      this.placer.active,
    ].join('#');
    if (key !== this.key) {
      this.key = key;
      this.render(mineB, units);
    }
    // live bars
    if (mineB) {
      const g = mineB.build;
      const bar = document.getElementById('cmd-grow');
      if (bar && g) (bar.firstElementChild as HTMLElement).style.width = `${(100 * g.progress) / g.total}%`;
      const q0 = mineB.queue?.[0];
      const qb = document.getElementById('cmd-q0');
      if (qb && q0) {
        const total = this.game.ctx.catalog.units.get(q0.unit)!.trainTicks;
        qb.style.width = `${(100 * q0.done) / total}%`;
      }
      const hp = document.getElementById('cmd-hp');
      if (hp) hp.textContent = `${mineB.hp}/${mineB.maxHp}`;
    }
  }

  private button(i: number, btn: Btn): string {
    const cost = [btn.cost[0] ? `${btn.cost[0]} ATP` : '', btn.cost[1] ? `${btn.cost[1]} ${this.game.world.players[this.game.me - 1]!.faction === 'wl' ? 'אמינו' : 'ברזל'}` : ''].filter(Boolean).join(' · ');
    const icon = btn.icon ? `<img src="${btn.icon}" alt="">` : '';
    const dis = btn.reason ? ` disabled title="${btn.reason}"` : '';
    return `<button type="button" class="act" data-i="${i}"${dis}>${icon}<span class="n">${btn.label}</span><small>${btn.reason ?? cost}</small></button>`;
  }

  private render(b: Entity | undefined, units: Entity[]): void {
    const { world, ctx } = this.game;
    const me = this.game.me;
    const card = $('cmd');
    this.actions = [];
    const html: string[] = [];
    const btns: Btn[] = [];
    if (b) {
      const def = ctx.catalog.buildings.get(b.type)!;
      html.push(`<div class="head"><img src="${this.iconOf(def.art)}" alt=""><b>${nameOf(b.type)}</b><span id="cmd-hp">${b.hp}/${b.maxHp}</span></div>`);
      if (b.build) {
        html.push(`<div class="bar" id="cmd-grow"><i></i></div><div class="hint">בצמיחה. טסיות לידו מאיצות אותה (לחיצה ימנית עם טסיות).</div>`);
        btns.push({ label: 'בטל בנייה', icon: '', cost: [0, 0], cmd: { type: 'CANCEL', units: [], building: b.id, what: 'build', index: 0 }, reason: null, key: 'cancel' });
      } else {
        if (b.queue) {
          const slots: string[] = [];
          for (let k = 0; k < QUEUE_MAX; k++) {
            const q = b.queue[k];
            if (!q) {
              slots.push('<span class="slot"></span>');
              continue;
            }
            this.actions.push({ cmd: { type: 'CANCEL', units: [], building: b.id, what: 'queue', index: k } });
            const bar = k === 0 ? `<i id="cmd-q0" class="${q.blocked ? 'blocked' : ''}"></i>` : '';
            slots.push(`<span class="slot full" data-i="${this.actions.length - 1}" title="לחיצה: ביטול (${q.started ? 'החזר 75%' : 'החזר מלא'})"><img src="${this.iconOf(q.unit)}" alt="">${bar}</span>`);
          }
          html.push(`<div class="queue">${slots.join('')}</div>`);
          if (b.queue[0]?.blocked) html.push('<div class="hint warn">היציאה חסומה — היחידה מחכה למקום פנוי</div>');
          for (const u of def.produces) {
            const ud = ctx.catalog.units.get(u)!;
            const cmd: Cmd = { type: 'TRAIN', units: [], building: b.id, unit: u, count: 1 };
            btns.push({ label: nameOf(u), icon: this.iconOf(u), cost: ud.cost, cmd, reason: this.reason(validateBuildingCmd(world, ctx, me, cmd), ud.requires), key: u });
          }
        }
        if (b.buildOrder) {
          const t = b.buildOrder.type;
          html.push(`<div class="hint">מוכן להצבה: <b>${nameOf(t)}</b></div>`);
          btns.push({ label: 'הצב', icon: this.iconOf(ctx.catalog.buildings.get(t)!.art), cost: [0, 0], cmd: null, reason: this.placer.active ? 'בחרו מקום על המפה' : null, key: 'place', then: () => this.placer.start(b.id, t) });
          btns.push({ label: 'בטל הזמנה', icon: '', cost: [0, 0], cmd: { type: 'CANCEL', units: [], building: b.id, what: 'order', index: 0 }, reason: null, key: 'cancel-order', then: () => this.placer.cancel() });
        } else if (ctx.catalog.factions.get(world.players[me - 1]!.faction)?.hq === b.type) {
          for (const t of ctx.catalog.buildings.values()) {
            if (t.faction !== world.players[me - 1]!.faction || t.placement === 'none' || t.placement === 'biofilm') continue;
            const cmd: Cmd = { type: 'QUEUE_BUILD', units: [], building: b.id, build: t.id };
            const r = validateBuildingCmd(world, ctx, me, cmd);
            btns.push({ label: nameOf(t.id), icon: this.iconOf(t.art), cost: t.cost, cmd, reason: this.reason(r, t.requires), key: t.id, then: () => (this.placeNext = { hq: b.id, type: t.id }) });
          }
        }
        if (b.queue) html.push('<div class="hint">לחיצה ימנית על המפה — לאן היחידות החדשות ילכו (על גביש: נשאים יכרו בו)</div>');
      }
    } else if (units.length) {
      const morphers = units.filter((u) => ctx.catalog.units.get(u.type)?.morphsTo && !u.morph);
      if (morphers.length) {
        const into = ctx.catalog.units.get(ctx.catalog.units.get(morphers[0]!.type)!.morphsTo!)!;
        const cmd: Cmd = { type: 'DEPLOY', units: morphers.map((u) => u.id) };
        btns.push({ label: `התמרה ל${nameOf(into.id)}`, icon: this.iconOf(into.id), cost: [into.cost[0] * morphers.length, into.cost[1] * morphers.length], cmd, reason: this.reason(validateUnitJob(world, ctx, me, cmd, morphers), into.requires), key: 'deploy' });
      }
      if (units.some((u) => ctx.catalog.units.get(u.type)?.role === 'builder')) html.push('<div class="hint">טסיות: לחיצה ימנית על מבנה בצמיחה — עזרה בבנייה; על מבנה פגוע — תיקון (בתשלום)</div>');
      if (units.some((u) => u.morph)) html.push('<div class="hint">מתמיר… לא זז עד שיסיים</div>');
    }
    const offset = this.actions.length;
    btns.forEach((btn) => this.actions.push({ cmd: btn.cmd, ...(btn.then ? { then: btn.then } : {}) }));
    if (btns.length) html.push(`<div class="grid">${btns.map((btn, k) => this.button(offset + k, btn)).join('')}</div>`);
    card.innerHTML = html.join('');
    card.hidden = html.length === 0;
  }
}
