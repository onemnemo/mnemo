import { describe, expect, it, vi } from 'vitest';

import { noteAssetRequestPath } from '../assets/api';
import {
  customCoverReference,
  customCoverRequestPath,
  isCustomCover,
  parseCoverCrop,
  serializeCoverCrop,
  uploadCover,
} from './cover-upload';

// Only the upload call is faked; the resolver stays real, because the delegation into it
// is the part that has a trap in it.
vi.mock('../assets/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assets/api')>()),
  uploadNoteAsset: vi.fn(() => Promise.resolve({ assetId: 'new.png', displayName: 'new.png' })),
}));

describe('custom cover tokens', () => {
  it('round-trips an asset id through the token', () => {
    const token = customCoverReference('abcd.png');
    expect(token).toBe('asset:abcd.png');
    expect(isCustomCover(token)).toBe(true);
  });

  it('reads a preset, a blank and a null as not custom', () => {
    expect(isCustomCover('sunset')).toBe(false);
    expect(isCustomCover('')).toBe(false);
    expect(isCustomCover(null)).toBe(false);
    expect(isCustomCover(undefined)).toBe(false);
  });

  it('strips the prefix before delegating, which the resolver requires', () => {
    // The resolver refuses anything with a colon, so a whole token handed over would
    // resolve to nothing at all. This is the reason the stripping happens first.
    expect(noteAssetRequestPath('asset:abcd.png')).toBeNull();
    expect(customCoverRequestPath('asset:abcd.png')).toBe('/api/notes/assets/abcd.png');
  });

  it('resolves nothing for a preset or an empty id', () => {
    expect(customCoverRequestPath('sunset')).toBeNull();
    expect(customCoverRequestPath(null)).toBeNull();
    expect(customCoverRequestPath('asset:')).toBeNull();
  });

  it('refuses an id that could walk out of the store', () => {
    expect(customCoverRequestPath('asset:..')).toBeNull();
    expect(customCoverRequestPath('asset:../../secrets.png')).toBeNull();
    expect(customCoverRequestPath('asset:sub/abcd.png')).toBeNull();
    expect(customCoverRequestPath('asset:sub\\abcd.png')).toBeNull();
  });
});

describe('uploadCover', () => {
  it('returns the minted id as a cover token', async () => {
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
    expect(await uploadCover(file)).toBe('asset:new.png');
  });
});

describe('cover crop grammar', () => {
  it('round-trips a crop through the stored string', () => {
    const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6, aspect: 1.5 };
    expect(parseCoverCrop(serializeCoverCrop(crop))).toEqual(crop);
  });

  it('reads null, empty and malformed strings as no crop', () => {
    expect(parseCoverCrop(null)).toBeNull();
    expect(parseCoverCrop('')).toBeNull();
    expect(parseCoverCrop('not json')).toBeNull();
    expect(parseCoverCrop('null')).toBeNull();
    expect(parseCoverCrop('42')).toBeNull();
    expect(parseCoverCrop('[]')).toBeNull();
  });

  it('refuses a window with a field missing or not a finite number', () => {
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1 }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: 'wide' }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: Number.NaN }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: Infinity }))).toBeNull();
  });

  it('refuses a non-positive aspect', () => {
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: 0 }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: -1.5 }))).toBeNull();
  });

  it('refuses a window that reaches outside the source', () => {
    expect(parseCoverCrop(JSON.stringify({ x: -0.1, y: 0, w: 1, h: 1, aspect: 1 }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1.2, h: 1, aspect: 1 }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: -0.01, aspect: 1 }))).toBeNull();
    // A zero-size window is degenerate rather than merely small, and an origin plus a size that
    // together overshoot the source is out of range even though neither number is by itself.
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 0, h: 1, aspect: 1 }))).toBeNull();
    expect(parseCoverCrop(JSON.stringify({ x: 0.5, y: 0, w: 0.6, h: 1, aspect: 1 }))).toBeNull();
  });

  it('accepts the whole source as a crop', () => {
    expect(parseCoverCrop(JSON.stringify({ x: 0, y: 0, w: 1, h: 1, aspect: 1 }))).toEqual({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      aspect: 1,
    });
  });
});
