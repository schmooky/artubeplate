// @artubeplate/core/assets — the game side of the asset pipeline.
//
//   import assets from 'artubeplate:assets';            // the manifest (from raw-assets/)
//   import { loadAssets, soundsFromManifest } from '@artubeplate/core/assets';
//
//   audio: { sounds: soundsFromManifest(assets), bgm: 'base' }        // in createArtubeGame
//   await loadAssets(assets, { onProgress: (p) => ctx.loader.setProgress(p) });   // in mountView
//   Texture.from('sym-H1')                              // a frame of a {tps} spritesheet, by name
//
// Textures go through Pixi's Assets (it picks @0.5x or @1x and webp or png per device); audio
// never does: `soundsFromManifest` hands every sound to zvuk, routed by its folder.

import { Assets, type AssetsManifest, type UnresolvedAsset } from 'pixi.js';
import type { BusName, SoundEntry } from '../audio/index';

/** The base path of the processed files, relative to the page (the plugin's `output`). */
export const DEFAULT_ASSETS_BASE = 'assets';

const AUDIO_EXT = /\.(webm|mp3|m4a|ogg|wav|flac)$/i;
const BUSES: readonly string[] = ['music', 'ambience', 'reels', 'symbols', 'anticipation', 'wins', 'voiceover', 'ui', 'reverb'];

type Entry = UnresolvedAsset & { alias?: string | string[]; src?: string | string[] };

const srcsOf = (a: Entry): string[] => (Array.isArray(a.src) ? a.src : a.src ? [a.src as string] : []).map((s) => (typeof s === 'string' ? s : String((s as { src?: string }).src ?? '')));
const isAudio = (a: Entry): boolean => {
  const s = srcsOf(a);
  return s.length > 0 && s.every((x) => AUDIO_EXT.test(x));
};
/** The path inside raw-assets without its {tags} or its source extension (`audio/reels/reel-stop.1`). */
const pathOf = (a: Entry): string => {
  const al = Array.isArray(a.alias) ? a.alias : a.alias ? [a.alias] : [];
  const longest = [...al].sort((x, y) => y.length - x.length)[0] ?? srcsOf(a)[0] ?? '';
  return longest.replace(AUDIO_EXT, '');
};
const join = (base: string, p: string): string => (base ? `${base.replace(/\/$/, '')}/${p}` : p);

/** The manifest without its audio (Pixi has no loader for it; zvuk plays it). */
export function textureManifest(manifest: AssetsManifest): AssetsManifest {
  return {
    bundles: manifest.bundles
      .map((b) => ({ ...b, assets: (Array.isArray(b.assets) ? (b.assets as Entry[]) : []).filter((a) => !isAudio(a)) }))
      .filter((b) => (b.assets as Entry[]).length > 0),
  };
}

export interface ImageUrlOptions {
  /** Where the processed files are served, relative to the page. Default `assets`. */
  basePath?: string;
  /** The formats to take, best first. Default webp, avif, png, jpg: webp is the one every browser draws in an `<img>`. */
  formats?: string[];
}

/**
 * The URL of an image for the DOM (a HUD card, the rules window, an `<img>`): the file behind
 * `alias` in the manifest, at full resolution, in the first of `formats` the pipeline wrote.
 * Pixi's textures need none of this (`Texture.from(alias)` after `loadAssets`). Undefined when the
 * manifest has no such image.
 */
export function imageUrl(manifest: AssetsManifest, alias: string, opts: ImageUrlOptions = {}): string | undefined {
  const formats = opts.formats ?? ['webp', 'avif', 'png', 'jpg', 'jpeg'];
  for (const bundle of manifest.bundles) {
    for (const a of Array.isArray(bundle.assets) ? (bundle.assets as Entry[]) : []) {
      const aliases = Array.isArray(a.alias) ? a.alias : a.alias ? [a.alias] : [];
      if (!aliases.includes(alias)) continue;
      const full = srcsOf(a).filter((s) => !/@\d+(\.\d+)?x\./.test(s) || /@1x\./.test(s));
      for (const f of formats) {
        const hit = full.find((s) => s.toLowerCase().endsWith(`.${f}`));
        if (hit) return join(opts.basePath ?? DEFAULT_ASSETS_BASE, hit);
      }
    }
  }
  return undefined;
}

export interface TextureResolutionOptions {
  /**
   * The screen the full-size (@1x) art is drawn for, in pixels, either way up. Default 2560×1440:
   * our backgrounds are 2560×1440 and 1440×2560.
   */
  reference?: [number, number];
  /** The most device pixels per CSS pixel the game renders (its renderer's cap). Default 2. */
  maxDpr?: number;
  /**
   * How far a smaller size may be stretched before the next one up is taken: 0.8 lets art be drawn
   * up to a quarter larger than its pixels (it is mostly drawn smaller than them). Default 0.8.
   */
  tolerance?: number;
  /** The device (for tests). Default: the screen and its pixel ratio. */
  device?: { width: number; height: number; dpr: number };
}

/**
 * Which of the texture sizes the pipeline wrote (`available`, e.g. [1, 0.5]) this device needs:
 * the smallest one that still fills its screen. The screen, not the window: a window can grow after
 * the load, a screen cannot. A phone (390×844 at 3x, rendered at 2x: 780 px across) takes @0.5x,
 * less than half the bytes; a 1920×1080 monitor and anything denser take @1x.
 */
export function textureResolutionFor(available: number[], opts: TextureResolutionOptions = {}): number {
  const sizes = [...new Set(available.filter((r) => r > 0))].sort((a, b) => a - b);
  if (!sizes.length) return 1;
  const device = opts.device ?? (typeof window === 'undefined' ? null : { width: window.screen?.width || window.innerWidth, height: window.screen?.height || window.innerHeight, dpr: window.devicePixelRatio || 1 });
  if (!device || !(device.width > 0 && device.height > 0)) return sizes[sizes.length - 1]!;
  const dpr = Math.min(Math.max(1, device.dpr), opts.maxDpr ?? 2);
  const [rw, rh] = opts.reference ?? [2560, 1440];
  // how much of the reference screen this one is, the long sides and the short sides compared
  const need = Math.min((Math.max(device.width, device.height) * dpr) / Math.max(rw, rh), (Math.min(device.width, device.height) * dpr) / Math.min(rw, rh));
  const enough = need * (opts.tolerance ?? 0.8);
  return sizes.find((r) => r >= enough) ?? sizes[sizes.length - 1]!;
}

/** The texture sizes a manifest holds, from its file names (`name@0.5x.webp` is 0.5, no suffix is 1). */
export function manifestResolutions(manifest: AssetsManifest): number[] {
  const found = new Set<number>();
  for (const b of manifest.bundles) {
    for (const a of Array.isArray(b.assets) ? (b.assets as Entry[]) : []) {
      if (isAudio(a)) continue;
      for (const src of srcsOf(a)) found.add(Number(/@(\d+(?:\.\d+)?)x\./.exec(src)?.[1] ?? 1));
    }
  }
  return [...found].sort((a, b) => a - b);
}

export interface LoadAssetsOptions extends TextureResolutionOptions {
  /** Bundles to load. Default: every bundle that has textures (or data), in manifest order. */
  bundles?: string[];
  /** Where the processed files are served, relative to the page. Default `assets`. */
  basePath?: string;
  /** 0..1 as the bundles load (feed the loader's progress bar). */
  onProgress?: (progress: number) => void;
  /** The texture size to load, of those the pipeline wrote. Default: `textureResolutionFor` this device. */
  resolution?: number;
}

let initialized = false;

/**
 * Load the manifest's texture bundles through Pixi's Assets, with progress. Each texture comes in
 * the size this device needs (`textureResolutionFor`: a phone does not download the full-size art)
 * and in the best format the browser decodes: avif, else webp. Safe to call more than once (later
 * calls load further bundles).
 */
export async function loadAssets(manifest: AssetsManifest, opts: LoadAssetsOptions = {}): Promise<void> {
  const textures = textureManifest(manifest);
  if (!initialized) {
    initialized = true;
    const sizes = manifestResolutions(textures);
    const want = opts.resolution ?? textureResolutionFor(sizes, opts);
    // the wanted size first, then the others by how close they are (a file missing in one size still loads)
    const resolution = [...sizes].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
    await Assets.init({ manifest: textures, basePath: opts.basePath ?? DEFAULT_ASSETS_BASE, texturePreference: { resolution: resolution.length ? resolution : [1], format: ['avif', 'webp', 'png', 'jpg', 'jpeg'] } });
  }
  const names = opts.bundles ?? textures.bundles.map((b) => b.name);
  if (!names.length) {
    opts.onProgress?.(1);
    return;
  }
  await Assets.loadBundle(names, (p) => opts.onProgress?.(p));
}

export interface SoundsFromManifestOptions {
  /** Where the processed files are served, relative to the page. Default `assets`. */
  basePath?: string;
  /** The bus for a sound outside any bus folder. Default `ui`. */
  defaultBus?: BusName;
  /** Seconds of crossfade at a plain music loop's boundary (no authored intro/outro). Default 0.4. */
  loopCrossfade?: number;
}

/**
 * The manifest's audio as zvuk entries, by convention:
 * - the folder is the bus: `audio/reels/reel-stop.wav` plays on `reels` as `reel-stop`;
 * - `name.1.wav`, `name.2.wav`… are VARIANTS of `name` (a different take on every play);
 * - in `music/`, `base.intro` / `base.loop` / `base.outro` are the stems of the track `base`
 *   (a lone `music/base.wav` is a plain loop).
 */
export function soundsFromManifest(manifest: AssetsManifest, opts: SoundsFromManifestOptions = {}): SoundEntry[] {
  const base = opts.basePath ?? DEFAULT_ASSETS_BASE;
  const fallback = opts.defaultBus ?? 'ui';
  const singles = new Map<string, { bus: BusName; takes: Map<number, string[]> }>();
  const music = new Map<string, { bus: BusName; intro?: string[]; loop?: string[]; outro?: string[] }>();
  for (const bundle of manifest.bundles) {
    for (const a of (Array.isArray(bundle.assets) ? bundle.assets : []) as Entry[]) {
      if (!isAudio(a)) continue;
      const urls = srcsOf(a)
        .sort((x, y) => Number(/\.mp3$/i.test(x)) - Number(/\.mp3$/i.test(y))) // webm (Opus) first, mp3 fallback
        .map((s) => join(base, s));
      const parts = pathOf(a).split('/');
      const file = parts.pop()!;
      const busDir = [...parts].reverse().find((p) => BUSES.includes(p));
      const bus = (busDir ?? fallback) as BusName;
      if (bus === 'music' || bus === 'ambience') {
        const m = /^(.*?)(?:\.(intro|loop|outro))?$/.exec(file)!;
        const track = music.get(m[1]!) ?? { bus };
        track[(m[2] as 'intro' | 'loop' | 'outro' | undefined) ?? 'loop'] = urls;
        music.set(m[1]!, track);
        continue;
      }
      const v = /^(.*)\.(\d+)$/.exec(file);
      const name = v ? v[1]! : file;
      const entry = singles.get(name) ?? { bus, takes: new Map<number, string[]>() };
      entry.takes.set(v ? Number(v[2]) : 0, urls);
      singles.set(name, entry);
    }
  }
  const out: SoundEntry[] = [];
  for (const [name, s] of singles) {
    const takes = [...s.takes.entries()].sort((x, y) => x[0] - y[0]).map(([, u]) => u);
    out.push(takes.length > 1 ? { name, kind: 'variants', urls: takes, bus: s.bus } : { name, url: takes[0]!, bus: s.bus });
  }
  for (const [name, m] of music) {
    if (!m.loop) continue;
    const authored = !!(m.intro || m.outro);
    out.push({
      name,
      kind: 'music',
      loop: m.loop,
      ...(m.intro ? { intro: m.intro } : {}),
      ...(m.outro ? { outro: m.outro } : {}),
      ...(authored ? {} : { loopCrossfadeMs: (opts.loopCrossfade ?? 0.4) * 1000 }),
      bus: m.bus as 'music' | 'ambience',
    });
  }
  return out;
}
