// The asset pipeline (Node side): AssetPack turns `raw-assets/` into game-ready files.
//
//   raw-assets/                       public/assets/  (generated, git-ignored)
//   ├── game{m}/                  →   game/…           a manifest bundle per {m} folder
//   │   ├── symbols{tps}/*.png    →   one spritesheet, @1x and @0.5x, png + webp
//   │   └── bg/*.jpg              →   jpg + webp, @1x and @0.5x
//   └── audio{m}/<bus>/*.wav      →   webm (Opus) + mp3, the codec ladder zvuk picks from
//
// Every output name carries a content hash, so the Artube CDN's year-long cache never serves a
// stale file. The manifest is not a file the game fetches: the Vite plugin hands it to the code as
// the virtual module `artubeplate:assets`, so it is bundled (and hashed) with the JS.
// AssetPack is an optional peer dependency, loaded only when a `raw-assets` folder exists.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AssetsOptions {
  /** The raw assets folder, relative to the Vite root. Default `raw-assets`. No folder, no pipeline. */
  entry?: string;
  /** The output folder inside Vite's public dir. Default `assets` (`public/assets`). */
  output?: string;
  /** Texture resolutions. Default `{ default: 1, low: 0.5 }`: Pixi picks @0.5x on small screens. */
  resolutions?: Record<string, number>;
  /**
   * The image formats the game ships. Default: **webp and avif, nothing else**. Every png and jpg
   * in `raw-assets/` is a source: it is written out as webp and as avif (at each resolution, sheets
   * included), and Pixi loads avif where the browser decodes it, webp everywhere else. No png or jpg
   * reaches `public/assets`. For a format: `true` is our settings, an object is sharp's options for
   * it merged over ours, `false` drops it; `png` / `jpg` set to `true` (or options) ship that format
   * as well, for a host that needs it.
   *
   * Ours: webp at quality 90 with its alpha untouched, avif at quality 80 in 4:4:4. (AssetPack's own
   * defaults cut every png to a 256-colour dithered palette and ring round soft edges in webp.)
   */
  images?: { webp?: boolean | Record<string, unknown>; avif?: boolean | Record<string, unknown>; png?: boolean | Record<string, unknown>; jpg?: boolean | Record<string, unknown> };
  /**
   * Audio bitrates in kbps. Every sound in `raw-assets/` (wav, flac, mp3...) is a source: it is
   * written as webm (Opus) and mp3, and the game takes the Opus where the browser plays it.
   * Default effects 64 (Opus) / 96 (mp3) mono; music 64 / 128 stereo. Music is most of a game's
   * download: at 64 kbps Opus two looping tracks are about 1.4 MB (96 kbps: 2.1 MB).
   */
  audio?: { effects?: { opus?: number; mp3?: number }; music?: { opus?: number; mp3?: number } };
  /** Extra AssetPack config merged over ours (pipes, ignore, assetSettings…). */
  assetpack?: Record<string, unknown>;
}

export interface ResolvedAssets {
  entry: string;
  output: string;
  /** Where AssetPack writes the manifest (inside its cache folder, never served). */
  manifestFile: string;
  cacheDir: string;
}

export const ASSETS_MODULE = 'artubeplate:assets';
export const EMPTY_MANIFEST = { bundles: [] as unknown[] };

export function resolveAssets(root: string, publicDir: string, opts: AssetsOptions): ResolvedAssets {
  const cacheDir = resolve(root, '.assetpack');
  return {
    entry: resolve(root, opts.entry ?? 'raw-assets'),
    output: resolve(publicDir, opts.output ?? 'assets'),
    manifestFile: join(cacheDir, 'artubeplate-manifest.json'),
    cacheDir,
  };
}

/** Our settings per image format (see `AssetsOptions.images`). */
export const IMAGE_DEFAULTS = Object.freeze({
  webp: Object.freeze({ quality: 90, alphaQuality: 100, smartSubsample: true }),
  avif: Object.freeze({ quality: 80, effort: 4, chromaSubsampling: '4:4:4' }),
  // only when a game asks for them: full colour, never a palette
  png: Object.freeze({ palette: false, compressionLevel: 9, adaptiveFiltering: true }),
  jpg: Object.freeze({ quality: 90, mozjpeg: true }),
});

export type ImageSetting = false | 'skip' | Record<string, unknown>;

/**
 * What AssetPack's compress pipes get per format. A source format the game does not ship is
 * `'skip'`: AssetPack then writes neither a recompressed copy nor the original (with plain `false`
 * it passes the source png / jpg through untouched). With webp and avif both switched off there
 * would be nothing to load, so png and jpg come back.
 */
export function imageSettings(images: AssetsOptions['images'] = {}): { webp: false | Record<string, unknown>; avif: false | Record<string, unknown>; png: ImageSetting; jpg: ImageSetting } {
  const own = (format: keyof typeof IMAGE_DEFAULTS, byDefault: boolean): false | Record<string, unknown> => {
    const v = images[format] ?? byDefault;
    if (v === false) return false;
    return { ...IMAGE_DEFAULTS[format], ...(v === true ? {} : v) };
  };
  const webp = own('webp', true);
  const avif = own('avif', true);
  const modern = webp !== false || avif !== false;
  return { webp, avif, png: own('png', !modern) || (modern ? 'skip' : false), jpg: own('jpg', !modern) || (modern ? 'skip' : false) };
}

/** The AssetPack config for an artubeplate game. */
export async function assetPackConfig(r: ResolvedAssets, opts: AssetsOptions): Promise<Record<string, unknown>> {
  const { pixiPipes } = await import('@assetpack/core/pixi');
  const fx = { opus: opts.audio?.effects?.opus ?? 64, mp3: opts.audio?.effects?.mp3 ?? 96 };
  const music = { opus: opts.audio?.music?.opus ?? 64, mp3: opts.audio?.music?.mp3 ?? 128 };
  const audioOutputs = (channels: number, rate: { opus: number; mp3: number }) => [
    { formats: ['.webm'], recompress: true, options: { audioCodec: 'libopus', audioBitrate: rate.opus, audioChannels: channels, audioFrequency: 48000 } },
    { formats: ['.mp3'], recompress: true, options: { audioBitrate: rate.mp3, audioChannels: channels, audioFrequency: 44100 } },
  ];
  const images = imageSettings(opts.images);
  return {
    entry: r.entry,
    output: r.output,
    cache: true,
    cacheLocation: r.cacheDir,
    logLevel: 'warn',
    // Notes next to the art (a README, a .psd source) are not game assets.
    ignore: ['**/*.md', '**/*.txt', '**/*.psd', '**/.DS_Store'],
    pipes: [
      ...pixiPipes({
        cacheBust: true,
        resolutions: opts.resolutions ?? { default: 1, low: 0.5 },
        compression: { png: images.png, webp: images.webp, avif: images.avif, jpg: images.jpg },
        texturePacker: { texturePacker: { removeFileExtension: true } },
        audio: { inputs: ['.wav', '.mp3', '.ogg', '.flac', '.webm', '.m4a'], outputs: audioOutputs(1, fx) },
        manifest: { output: r.manifestFile, trimExtensions: true, createShortcuts: true },
      }),
    ],
    // Music stays stereo, at a higher bitrate.
    assetSettings: [{ files: ['**/music/**'], settings: { audio: { outputs: audioOutputs(2, music) } } }],
    ...opts.assetpack,
  };
}

export function readManifest(r: ResolvedAssets): unknown {
  if (!existsSync(r.manifestFile)) return EMPTY_MANIFEST;
  return JSON.parse(readFileSync(r.manifestFile, 'utf8')) as unknown;
}

/** One build of the assets (`vite build`, or the `artubeplate assets` command). */
export async function buildAssets(r: ResolvedAssets, opts: AssetsOptions): Promise<unknown> {
  if (!existsSync(r.entry)) return EMPTY_MANIFEST;
  const { AssetPack } = await import('@assetpack/core');
  const ap = new AssetPack((await assetPackConfig(r, opts)) as never);
  await ap.run();
  return readManifest(r);
}

/** Watch the raw assets (dev): `onChange` gets the new manifest after every rebuild. */
export async function watchAssets(r: ResolvedAssets, opts: AssetsOptions, onChange: (manifest: unknown) => void): Promise<{ stop(): Promise<void>; ready: Promise<unknown> }> {
  if (!existsSync(r.entry)) return { stop: async () => {}, ready: Promise.resolve(EMPTY_MANIFEST) };
  const { AssetPack } = await import('@assetpack/core');
  const ap = new AssetPack((await assetPackConfig(r, opts)) as never);
  let first = true;
  let markReady!: (m: unknown) => void;
  const ready = new Promise<unknown>((res) => (markReady = res));
  void ap.watch(() => {
    const manifest = readManifest(r);
    if (first) {
      first = false;
      markReady(manifest);
    } else onChange(manifest);
  });
  return { stop: () => ap.stop(), ready };
}
