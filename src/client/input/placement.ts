// Placing an ordered building: a ghost of it follows the mouse, snapped to tiles, with each
// footprint tile green or red and the reason in words. The check is the simulation's own
// (checkPlacement), so green here means the order will most likely stand; the simulation
// still checks again on the tick it runs.

import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { checkPlacement, type PlaceReason } from '../../sim/build/placement';
import { footprintOrigin } from '../../sim/context';
import type { Entity } from '../../sim/core/world';
import type { Game } from '../game';
import { TILE_PX } from '../render/terrain';

export const PLACE_TEXT: Record<PlaceReason, string> = {
  out_of_bounds: 'מחוץ למפה',
  bad_ground: 'אי אפשר לבנות על הקרקע הזו',
  site_blocked: 'המקום תפוס',
  too_far: 'רחוק מדי — עד 8 אריחים ממבנה שלכם',
  no_builder: 'צריך חוליית טסיות במקום',
  blocks_exit: 'זה יחסום יציאה של מבנה ייצור',
  no_deposit: 'רק על מרבץ פנוי',
  cannot_place: 'אי אפשר לבנות את זה כאן',
};

export class Placer {
  readonly layer = new Container();
  private readonly tiles = new Graphics();
  private ghost: Sprite | null = null;
  private readonly label: Text;
  /** the lymph node whose order is being placed */
  hq: number | null = null;
  type: string | null = null;
  tx = 0;
  ty = 0;
  reason: PlaceReason | null = null;

  constructor(
    private readonly game: Game,
    private readonly textures: Map<string, Texture>,
    private readonly canSee: (e: Entity) => boolean,
  ) {
    this.label = new Text({ text: '', style: { fontFamily: 'Assistant, sans-serif', fontSize: 14, fontWeight: '700', fill: 0xffffff, stroke: { color: 0x1c0f1a, width: 4 } } });
    this.label.anchor.set(0.5, 0);
    this.layer.addChild(this.tiles, this.label);
    this.layer.visible = false;
  }

  get active(): boolean {
    return this.hq !== null;
  }

  start(hq: number, type: string): void {
    this.cancel();
    const def = this.game.ctx.catalog.buildings.get(type);
    if (!def) return;
    this.hq = hq;
    this.type = type;
    const tex = this.textures.get(def.art);
    if (tex) {
      this.ghost = new Sprite(tex);
      this.ghost.anchor.set(0.5, 0.7);
      this.ghost.scale.set(def.artScale / 1000);
      this.ghost.alpha = 0.6;
      this.layer.addChildAt(this.ghost, 0);
    }
    this.layer.visible = true;
  }

  cancel(): void {
    this.hq = null;
    this.type = null;
    this.ghost?.destroy();
    this.ghost = null;
    this.layer.visible = false;
  }

  /** Follows the mouse (world pixels): snaps the footprint, checks it, draws it. */
  hover(wx: number, wy: number): void {
    if (!this.type) return;
    const { world, ctx } = this.game;
    const def = ctx.catalog.buildings.get(this.type)!;
    const [fw, fh] = def.footprint;
    let tx = Math.round(wx / TILE_PX - fw / 2);
    let ty = Math.round(wy / TILE_PX - fh / 2);
    if (def.placement === 'resource') {
      // an extractor snaps onto the deposit under the mouse
      for (const e of world.entities) {
        if (!e.res || ctx.catalog.resources.get(e.type)?.kind !== def.onResource) continue;
        const [ox, oy, ow, oh] = footprintOrigin(ctx, e.type, e.x, e.y);
        if (wx >= (ox - 1) * TILE_PX && wx < (ox + ow + 1) * TILE_PX && wy >= (oy - 1) * TILE_PX && wy < (oy + oh + 1) * TILE_PX) {
          tx = ox;
          ty = oy;
        }
      }
    }
    this.tx = tx;
    this.ty = ty;
    const c = checkPlacement(world, ctx, this.game.me, this.type, tx, ty, this.canSee);
    this.reason = c.ok ? null : c.reason;
    const g = this.tiles;
    g.clear();
    const colour = c.ok ? 0x7ee081 : 0xe8173f;
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) g.rect(x * TILE_PX + 1, y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2).fill({ color: colour, alpha: 0.32 }).stroke({ width: 1, color: colour, alpha: 0.8 });
    if (def.produces.length > 0) {
      // where its units will come out
      const ex = tx + Math.floor(fw / 2);
      const ey = ty + fh;
      g.circle(ex * TILE_PX + TILE_PX / 2, ey * TILE_PX + TILE_PX / 2, 5).fill({ color: 0xffd34d, alpha: 0.9 });
    }
    const cx = (tx + fw / 2) * TILE_PX;
    const cy = (ty + fh / 2) * TILE_PX;
    if (this.ghost) {
      this.ghost.position.set(cx, (ty + fh / 2) * TILE_PX + 0.2 * fh * TILE_PX);
      this.ghost.tint = c.ok ? 0xffffff : 0xff8080;
    }
    this.label.text = c.ok ? '' : PLACE_TEXT[c.reason];
    this.label.position.set(cx, (ty + fh) * TILE_PX + 6);
  }

  /** Sends the order; placement mode ends when the building appears (see Hud). */
  click(): void {
    if (this.hq === null || this.reason) return;
    this.game.issue({ type: 'PLACE_BUILD', units: [], building: this.hq, tx: this.tx, ty: this.ty });
  }
}
