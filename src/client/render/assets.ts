import { Assets, Spritesheet, Texture } from 'pixi.js';

export interface AssetRecord {
  kind: string;
  faction?: string;
  w: number;
  h: number;
  anchor?: [number, number];
  radius?: number;
  footprint?: [number, number];
  frames?: string[];
  fps?: number;
  blend?: 'add' | 'key';
  file?: string;
  atlas?: string[];
}

export interface AtlasPage { image: string; json: string; w: number; h: number; sprites: number }

export interface Manifest {
  version: number;
  tilePx: number;
  texScale: number;
  atlases: Record<string, AtlasPage[]>;
  assets: Record<string, AssetRecord>;
  missing: string[];
}

const BASE = 'assets/';

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(BASE + 'manifest.json');
  if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
  return (await res.json()) as Manifest;
}

/**
 * Loads the named atlas groups and returns a frame-name → texture lookup. `pages` limits a
 * group to some of its pages ("fx_b:0"), so a few effects do not pull in a whole effects set.
 */
export async function loadAtlasGroups(manifest: Manifest, groups: string[]): Promise<Map<string, Texture>> {
  const textures = new Map<string, Texture>();
  const pages = groups.flatMap((g) => {
    const [name, only] = g.split(':');
    const all = manifest.atlases[name!] ?? [];
    return only === undefined ? all : all.filter((_, i) => only.split(',').includes(String(i)));
  });
  const sheets = await Promise.all(pages.map((p) => Assets.load<Spritesheet>(BASE + p.json)));
  for (const sheet of sheets) for (const [name, tex] of Object.entries(sheet.textures)) textures.set(name, tex);
  return textures;
}

/** A texture for a missing id: a magenta box, so a gap is visible but never fatal. */
export function missingTexture(): Texture {
  return Texture.WHITE;
}
