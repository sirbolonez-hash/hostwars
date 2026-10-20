// The fog over the map, for one player: black where they have never looked, dimmed where
// they have looked but see nothing now, clear where they see. One pixel per tile, scaled up
// with smoothing, so the edges are soft. Reads the simulation's vision; never writes it.

import { Sprite, Texture } from 'pixi.js';
import type { SimContext } from '../../sim/context';
import type { World } from '../../sim/core/world';
import { exploredBit } from '../../sim/vision/vision';
import { TILE_PX } from './terrain';

const UNEXPLORED = 235;
const EXPLORED = 120;

export class FogLayer {
  readonly sprite: Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly texture: Texture;
  private lastTick = -1;
  /** test lab: show everything */
  off = false;

  constructor(private readonly ctx: SimContext) {
    const { w, h } = ctx.nav;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.img = this.g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      this.img.data[i * 4] = 18;
      this.img.data[i * 4 + 1] = 8;
      this.img.data[i * 4 + 2] = 16;
    }
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'linear';
    this.sprite = new Sprite(this.texture);
    this.sprite.scale.set(TILE_PX);
    // tile centres line up with pixel centres
    this.sprite.position.set(0, 0);
  }

  update(world: World, player: number): void {
    this.sprite.visible = !this.off;
    if (this.off || world.tick === this.lastTick) return;
    this.lastTick = world.tick;
    const v = this.ctx.vision;
    const d = this.img.data;
    const n = v.w * v.h;
    for (let i = 0; i < n; i++) {
      const a = v.sees(player, i % v.w, Math.floor(i / v.w)) ? 0 : exploredBit(world, player, i) ? EXPLORED : UNEXPLORED;
      d[i * 4 + 3] = a;
    }
    this.g.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }
}
