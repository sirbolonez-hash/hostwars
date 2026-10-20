// The Hebrew interface around the battlefield: resources, selection, test buttons, help
// and the performance line. Plain DOM over the canvas, so text, RTL and fonts just work.

import type { Game } from '../game';
import type { Controls } from '../input/controls';
import type { WorldView } from '../render/worldView';
import { nameOf } from './names';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private fpsFrames = 0;
  private fpsAcc = 0;
  private fps = 0;
  private lastSelKey = '';

  constructor(
    private readonly game: Game,
    private readonly controls: Controls,
    private readonly view: WorldView,
    gpu: string,
    private readonly spawnAt: () => [number, number],
  ) {
    $('gpu').textContent = gpu;
    controls.onChange = () => this.refreshSelection(true);
    $('btn-20').addEventListener('click', () => this.spawn('unit_wl_neutrophil', 20));
    $('btn-80').addEventListener('click', () => this.spawn('unit_wl_neutrophil', 80, true));
    $('btn-macro').addEventListener('click', () => this.spawn('unit_wl_macrophage', 6));
    $('btn-mix').addEventListener('click', () => {
      this.spawn('unit_wl_monocyte', 8);
      this.spawn('unit_wl_eosinophil', 8);
    });
    $('btn-debug').addEventListener('click', () => {
      view.debugOn = !view.debugOn;
      this.refreshSelection(true);
    });
    $('btn-speed').addEventListener('click', () => {
      game.speed = game.speed === 1 ? 2 : game.speed === 2 ? 0.5 : 1;
      $('btn-speed').textContent = `מהירות ×${game.speed}`;
    });
    $('btn-pause').addEventListener('click', () => {
      game.paused = !game.paused;
      $('btn-pause').textContent = game.paused ? 'המשך' : 'השהה';
    });
  }

  /** Spawns through the dev command, then selects the newcomers once they exist. */
  private spawn(unit: string, count: number, nearChoke = false): void {
    const [x, y] = nearChoke ? [18 * 256, 28 * 256] : this.spawnAt();
    const before = this.game.world.nextId;
    this.game.issue({ type: 'DEV_SPAWN', units: [], unit, count, x, y });
    const wait = () => {
      if (this.game.world.nextId === before) {
        requestAnimationFrame(wait);
        return;
      }
      this.controls.selected.clear();
      for (const e of this.game.world.entities) if (e.id >= before && e.type === unit) this.controls.selected.add(e.id);
      this.refreshSelection(true);
      if (nearChoke) $('tip').textContent = 'עכשיו לחיצה ימנית מזרח לחומה (מעבר לפתח הצר) — ותראו אותם עוברים.';
    };
    requestAnimationFrame(wait);
  }

  private refreshSelection(force = false): void {
    const ids = this.controls.liveSelection();
    const key = ids.join(',') + '|' + this.view.debugOn;
    if (!force && key === this.lastSelKey) return;
    this.lastSelKey = key;
    const counts = new Map<string, number>();
    for (const e of this.game.world.entities) if (this.controls.selected.has(e.id)) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
    const sel = $('selection');
    if (ids.length === 0) sel.textContent = 'לא נבחרו יחידות';
    else sel.textContent = `${ids.length} נבחרו · ` + [...counts].map(([t, n]) => `${nameOf(t)} ×${n}`).join(' · ');
    $('btn-debug').setAttribute('aria-pressed', String(this.view.debugOn));
  }

  update(dtMs: number): void {
    this.fpsFrames++;
    this.fpsAcc += dtMs;
    if (this.fpsAcc >= 500) {
      this.fps = (this.fpsFrames * 1000) / this.fpsAcc;
      this.fpsFrames = 0;
      this.fpsAcc = 0;
      const w = this.game.world;
      const p = w.players[this.game.me - 1]!;
      $('res').textContent = `ATP ${p.basic} · אמינו ${p.advanced} · אספקה ${p.supplyUsed}/${p.supplyCap}`;
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
