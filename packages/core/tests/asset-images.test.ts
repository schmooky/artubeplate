import { describe, it, expect } from 'vitest';
import type { AssetsManifest } from 'pixi.js';
import { IMAGE_DEFAULTS, imageSettings } from '../src/assets/pipeline';
import { imageUrl } from '../src/assets';

/**
 * A GAME SHIPS WEBP AND AVIF, NOTHING ELSE.
 *
 * Every png and jpg in raw-assets is a source. AssetPack's own defaults wrote the png back as a
 * 256-colour dithered palette (sharp reads `quality: 90` as "use a palette"): flat stickers survive
 * that, shaded art came out speckled wherever the png was what loaded (the HUD's cards, the paytable).
 * Now the pipeline writes webp and avif only; Pixi takes avif where the browser decodes it and webp
 * elsewhere, and the DOM takes webp.
 */
describe('image settings for the asset pipeline', () => {
  it('by default: webp and avif on, png and jpg skipped (no copy, no pass-through of the source)', () => {
    const s = imageSettings();
    expect(s.webp).toMatchObject({ quality: 90, alphaQuality: 100 });
    expect(s.avif).toMatchObject({ quality: 80, chromaSubsampling: '4:4:4' });
    expect(s.png).toBe('skip');
    expect(s.jpg).toBe('skip');
  });

  it('a game merges its own options over ours, format by format', () => {
    const s = imageSettings({ webp: { quality: 75 }, avif: { effort: 6 } });
    expect(s.webp).toEqual({ ...IMAGE_DEFAULTS.webp, quality: 75 });
    expect(s.avif).toEqual({ ...IMAGE_DEFAULTS.avif, effort: 6 });
  });

  it('one modern format can go: the other stays, png and jpg stay skipped', () => {
    expect(imageSettings({ avif: false })).toMatchObject({ avif: false, png: 'skip', jpg: 'skip' });
    expect(imageSettings({ avif: false }).webp).toMatchObject({ quality: 90 });
  });

  it('a game that asks for png gets it in full colour, never a palette', () => {
    const s = imageSettings({ png: true });
    expect(s.png).toMatchObject({ palette: false });
    expect(s.png).not.toHaveProperty('quality');
    expect(s.jpg).toBe('skip');
  });

  it('with webp and avif both off there is still something to load: png and jpg come back', () => {
    const s = imageSettings({ webp: false, avif: false });
    expect(s.png).toMatchObject({ palette: false });
    expect(s.jpg).toMatchObject({ quality: 90 });
  });
});

describe('imageUrl: an image for the DOM', () => {
  const manifest = {
    bundles: [
      {
        name: 'game',
        assets: [
          { alias: ['game/ui/card-buy.png', 'card-buy'], src: ['game/ui/card-buy-a1@0.5x.avif', 'game/ui/card-buy-a2.avif', 'game/ui/card-buy-w1@0.5x.webp', 'game/ui/card-buy-w2.webp'] },
          { alias: ['old'], src: ['game/ui/old-p1.png', 'game/ui/old-p2@0.5x.png'] },
        ],
      },
    ],
  } as unknown as AssetsManifest;

  it('takes the full-resolution webp (every browser draws it in an <img>)', () => {
    expect(imageUrl(manifest, 'card-buy')).toBe('assets/game/ui/card-buy-w2.webp');
  });
  it('takes the formats in the order asked for, under the base path given', () => {
    expect(imageUrl(manifest, 'card-buy', { formats: ['avif', 'webp'], basePath: 'static/' })).toBe('static/game/ui/card-buy-a2.avif');
  });
  it('falls back to what an older build wrote; undefined for an unknown alias', () => {
    expect(imageUrl(manifest, 'old')).toBe('assets/game/ui/old-p1.png');
    expect(imageUrl(manifest, 'nope')).toBeUndefined();
  });
});

/**
 * A PHONE DOES NOT DOWNLOAD THE FULL-SIZE ART.
 *
 * The pipeline writes every texture at @1x and @0.5x, but nothing told Pixi which to take, and its
 * default is @1x: every device loaded the full-size files (Sushi Up Bonanza: 2.4 MB of images where
 * 0.9 MB fills a phone's screen).
 */
import { manifestResolutions, textureResolutionFor } from '../src/assets';

describe('the texture size a device loads', () => {
  const pick = (width: number, height: number, dpr: number) => textureResolutionFor([1, 0.5], { device: { width, height, dpr } });

  it('phones take @0.5x, whichever way up (rendered at 2x at the most)', () => {
    expect(pick(390, 844, 3)).toBe(0.5);
    expect(pick(844, 390, 3)).toBe(0.5);
    expect(pick(430, 932, 3)).toBe(0.5);
    expect(pick(360, 640, 2)).toBe(0.5);
  });
  it('a small or plain-density desktop takes @0.5x, a full HD one and anything denser @1x', () => {
    expect(pick(1280, 800, 1)).toBe(0.5);
    expect(pick(1920, 1080, 1)).toBe(1);
    expect(pick(1440, 900, 2)).toBe(1);
    expect(pick(2560, 1440, 1)).toBe(1);
  });
  it('a tablet takes @1x', () => {
    expect(pick(768, 1024, 2)).toBe(1);
  });
  it('takes what there is: one size, or none listed', () => {
    expect(textureResolutionFor([1], { device: { width: 390, height: 844, dpr: 3 } })).toBe(1);
    expect(textureResolutionFor([], { device: { width: 390, height: 844, dpr: 3 } })).toBe(1);
  });
  it('a game with art drawn for another screen says so', () => {
    expect(textureResolutionFor([1, 0.5], { reference: [1920, 1080], device: { width: 390, height: 844, dpr: 3 } })).toBe(1);
  });
  it('reads the sizes a manifest holds from its file names, audio left out', () => {
    const m = { bundles: [{ name: 'g', assets: [{ alias: ['a'], src: ['g/a-1@0.5x.avif', 'g/a-2.avif', 'g/a-3@0.5x.webp', 'g/a-4.webp'] }, { alias: ['s'], src: ['audio/x.webm', 'audio/x.mp3'] }] }] } as unknown as AssetsManifest;
    expect(manifestResolutions(m)).toEqual([0.5, 1]);
  });
});
