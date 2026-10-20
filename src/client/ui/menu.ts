// The menus before a match: campaign or skirmish; the campaign's missions with what is
// unlocked; and, before a mission, its cinematic picture and its briefing, one speaker at a
// time. Progress is kept in this browser (localStorage): a convenience, the game runs without it.

import type { Difficulty } from '../../ai/types';
import type { MissionDef } from '../../sim/content/types';

export type Choice =
  | { kind: 'skirmish'; faction: 'wl' | 'col'; level: Difficulty; dev: boolean }
  | { kind: 'mission'; id: string; dev: boolean };

/** Who speaks in briefings and during missions: their name and portrait. */
export const SPEAKERS: Record<string, { name: string; portrait: string }> = {
  general4: { name: 'האלוף ארבע', portrait: 'assets/portraits/portrait_general4.webp' },
  nurse: { name: 'האח האחראי', portrait: 'assets/portraits/portrait_nurse.webp' },
  bigmac: { name: 'ביג-מק', portrait: 'assets/portraits/portrait_bigmac.webp' },
  dendra: { name: 'ד"ר דנדרה', portrait: 'assets/portraits/portrait_dendra.webp' },
  doctor: { name: 'ד"ר שחר', portrait: 'assets/portraits/portrait_doctor.webp' },
};

const KEY = 'hostwars.campaign.v1';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Missions finished in this browser. */
export function finished(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { done?: string[] };
    return Array.isArray(v.done) ? v.done : [];
  } catch {
    return [];
  }
}

export function markFinished(id: string): void {
  try {
    const done = new Set(finished());
    done.add(id);
    localStorage.setItem(KEY, JSON.stringify({ done: [...done] }));
  } catch {
    // no storage here: progress lives for this visit only
  }
}

/** A match asked for in the address (after "next mission" or "try again"): #mission=m02 */
export function fromAddress(): Choice | null {
  const m = /mission=(m\d\d)/.exec(location.hash);
  if (!m) return null;
  return { kind: 'mission', id: m[1]!, dev: /dev=1/.test(location.hash) };
}

/** Shows the menus and resolves with what the player picked. */
export function chooseMatch(missions: MissionDef[]): Promise<Choice> {
  const show = (id: string) => {
    for (const card of ['menu-main', 'menu-campaign', 'menu-skirmish']) $(card).hidden = card !== id;
  };
  show('menu-main');
  return new Promise((resolve) => {
    const dev = () => ($('pick-dev') as HTMLInputElement).checked;
    $('to-campaign').onclick = () => {
      renderMissions(missions, (id) => resolve({ kind: 'mission', id, dev: dev() }), dev());
      show('menu-campaign');
    };
    $('to-skirmish').onclick = () => show('menu-skirmish');
    for (const b of document.querySelectorAll<HTMLButtonElement>('#start .back')) b.onclick = () => show('menu-main');
    ($('pick-dev') as HTMLInputElement).onchange = () => renderMissions(missions, (id) => resolve({ kind: 'mission', id, dev: dev() }), dev());
    // skirmish: a side and a difficulty
    const choice = { faction: 'wl' as 'wl' | 'col', level: 'normal' as Difficulty };
    const pick = (cls: string, set: (v: string) => void, attr: string) => {
      const btns = [...document.querySelectorAll<HTMLButtonElement>(`#start .${cls}`)];
      for (const b of btns)
        b.onclick = () => {
          for (const o of btns) o.setAttribute('aria-pressed', String(o === b));
          set(b.dataset[attr]!);
        };
    };
    pick('side', (v) => (choice.faction = v as 'wl' | 'col'), 'faction');
    pick('level', (v) => (choice.level = v as Difficulty), 'level');
    $('start-btn').onclick = () => resolve({ kind: 'skirmish', faction: choice.faction, level: choice.level, dev: dev() });
  });
}

function renderMissions(missions: MissionDef[], go: (id: string) => void, all: boolean): void {
  const done = new Set(finished());
  const list = $('missions');
  list.innerHTML = '';
  missions.forEach((m, k) => {
    const open = all || k === 0 || done.has(missions[k - 1]!.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mission';
    b.disabled = !open;
    b.innerHTML =
      `<img src="assets/maps/preview/map_${m.id}_${MAP_SUFFIX[m.id] ?? ''}.webp" alt="">` +
      `<span class="num">משימה ${m.number}</span><b>${m.title}</b>` +
      `<small>${done.has(m.id) ? '✓ הושלמה' : open ? 'פתוחה' : 'נעולה — סיימו את הקודמת'}</small>`;
    b.onclick = () => go(m.id);
    list.appendChild(b);
  });
}

const MAP_SUFFIX: Record<string, string> = { m01: 'skin', m02: 'subcutis', m03: 'lymphnode' };

/** Before a mission: its cinematic picture, then the briefing, one line at a time. */
export function playStory(def: MissionDef): Promise<void> {
  const story = $('story');
  const img = $('story-img') as HTMLImageElement;
  const who = $('story-who');
  const face = $('story-face') as HTMLImageElement;
  const text = $('story-text');
  const steps: { image: string; speaker: string | null; text: string }[] = [
    { image: `assets/cine/${def.cine}.webp`, speaker: null, text: `משימה ${def.number} · ${def.title}` },
    ...def.briefing.map((b) => ({ image: 'assets/cine/ui_briefing_bg.webp', speaker: b.speaker, text: b.text })),
  ];
  story.hidden = false;
  let k = 0;
  return new Promise((resolve) => {
    const showStep = () => {
      const s = steps[k]!;
      img.src = s.image;
      story.classList.toggle('title', s.speaker === null);
      const sp = s.speaker ? SPEAKERS[s.speaker] : null;
      face.hidden = !sp;
      if (sp) face.src = sp.portrait;
      who.textContent = sp?.name ?? '';
      text.textContent = s.text;
      $('story-next').textContent = k === steps.length - 1 ? 'למשימה' : 'המשך';
    };
    const next = () => {
      k++;
      if (k >= steps.length) {
        story.hidden = true;
        window.removeEventListener('keydown', key);
        resolve();
      } else showStep();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') next();
      if (e.code === 'Escape') {
        k = steps.length - 1;
        next();
      }
    };
    $('story-next').onclick = next;
    $('story-skip').onclick = () => {
      k = steps.length - 1;
      next();
    };
    window.addEventListener('keydown', key);
    showStep();
  });
}
