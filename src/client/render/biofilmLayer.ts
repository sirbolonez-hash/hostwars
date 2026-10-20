// The Colony's biofilm on the ground: a soft, slightly glossy film, one pixel per tile scaled
// up with smoothing (like the fog). A player sees their own biofilm always, and someone
// else's only where they see the ground now: nothing hidden leaks through it.

import { Sprite, Texture } from 'pixi.js';
import type { SimContext } from '../../sim/context';
import type { World } from '../../sim/core/world';
import { TILE_PX } from './terrain';

/** biofilm colours by whose it is: mine, an enemy's */
const MINE: [number, number, number, number] = [150, 214, 92, 110];
const THEIRS: [number, number, number, number] = [196, 120, 214, 120];

export class BiofilmLayer {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly texture: Texture;
  private lastTick = -1;

  constructor(private readonly ctx: SimContext) {
    const { w, h } = ctx.nav;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.img = this.g.createImageData(w, h);
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'linear';
    this.sprite = new Sprite(this.texture);
    this.sprite.scale.set(TILE_PX);
  }

  /** Redrawn every few ticks: biofilm grows a tile every four seconds at most. */
  update(world: World, me: number, revealAll: boolean): void {
    if (world.tick - this.lastTick < 5 && this.lastTick >= 0) return;
    this.lastTick = world.tick;
    const bf = this.ctx.biofilm;
    const v = this.ctx.vision;
    const d = this.img.data;
    const myTeam = world.players[me - 1]?.team ?? 0;
    for (let i = 0; i < bf.w * bf.h; i++) {
      const o = bf.owner[i]!;
      let c: [number, number, number, number] | null = null;
      if (o !== 0) {
        const mine = world.players[o - 1]?.team === myTeam;
        if (mine) c = MINE;
        else if (revealAll || v.sees(me, i % bf.w, Math.floor(i / bf.w))) c = THEIRS;
      }
      d[i * 4] = c ? c[0] : 0;
      d[i * 4 + 1] = c ? c[1] : 0;
      d[i * 4 + 2] = c ? c[2] : 0;
      d[i * 4 + 3] = c ? c[3] : 0;
    }
    this.g.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }
}

/** Pus on the ground, where neutrophils died: a creamy yellow film, seen like biofilm (own side always, else where seen). */
export class PusLayer {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly texture: Texture;
  private lastTick = -1;

  constructor(private readonly ctx: SimContext) {
    const { w, h } = ctx.nav;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.img = this.g.createImageData(w, h);
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'linear';
    this.sprite = new Sprite(this.texture);
    this.sprite.scale.set(TILE_PX);
  }

  update(world: World, me: number, revealAll: boolean): void {
    if (world.tick - this.lastTick < 5 && this.lastTick >= 0) return;
    this.lastTick = world.tick;
    const d = this.img.data;
    d.fill(0);
    const v = this.ctx.vision;
    const w = this.ctx.map.w;
    for (const p of world.pus) {
      if (!revealAll && !v.sees(me, p.i % w, Math.floor(p.i / w))) continue;
      d[p.i * 4] = 236;
      d[p.i * 4 + 1] = 222;
      d[p.i * 4 + 2] = 128;
      d[p.i * 4 + 3] = 150;
    }
    this.g.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }
}
