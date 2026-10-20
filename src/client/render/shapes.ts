// Small textures drawn in code: unit shadow, selection ring, team markers, the current's
// chevrons, and the move marker. White where they get tinted per team.

import { Graphics, type Renderer, Texture } from 'pixi.js';

export interface Shapes {
  shadow: Texture;
  ring: Texture;
  markCircle: Texture;
  markDiamond: Texture;
  chevron: Texture;
  dot: Texture;
}

function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  return Texture.from(cv);
}

export function makeShapes(renderer: Renderer): Shapes {
  const shadow = canvasTexture(128, 64, (c) => {
    const g = c.createRadialGradient(64, 32, 4, 64, 32, 62);
    g.addColorStop(0, 'rgba(42,21,48,0.55)');
    g.addColorStop(1, 'rgba(42,21,48,0)');
    c.fillStyle = g;
    c.scale(1, 0.5);
    c.beginPath();
    c.arc(64, 64, 62, 0, Math.PI * 2);
    c.fill();
  });
  const ring = renderer.generateTexture({
    target: new Graphics().ellipse(0, 0, 60, 26).stroke({ width: 6, color: 0xffffff }).ellipse(0, 0, 60, 26).stroke({ width: 2, color: 0x2a1530, alpha: 0.5 }),
    resolution: 1,
  });
  const markCircle = renderer.generateTexture({ target: new Graphics().circle(0, 0, 9).fill(0xffffff).stroke({ width: 3, color: 0x2a1530 }), resolution: 2 });
  const markDiamond = renderer.generateTexture({ target: new Graphics().poly([0, -11, 10, 0, 0, 11, -10, 0]).fill(0xffffff).stroke({ width: 3, color: 0x2a1530 }), resolution: 2 });
  const chevron = canvasTexture(64, 64, (c) => {
    c.strokeStyle = 'rgba(255, 220, 225, 0.35)';
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(18, 22);
    c.lineTo(32, 36);
    c.lineTo(46, 22);
    c.stroke();
  });
  const dot = renderer.generateTexture({ target: new Graphics().circle(0, 0, 8).fill(0xffffff), resolution: 2 });
  return { shadow, ring, markCircle, markDiamond, chevron, dot };
}
