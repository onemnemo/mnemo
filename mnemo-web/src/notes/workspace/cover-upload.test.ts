import { describe, expect, it, vi } from 'vitest';

import { noteAssetRequestPath } from '../assets/api';
import {
  MAX_COVER_BYTES,
  coverUploadProblem,
  customCoverReference,
  customCoverRequestPath,
  isCustomCover,
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

describe('coverUploadProblem', () => {
  it('accepts a file of exactly the limit and refuses one byte more', () => {
    expect(coverUploadProblem({ name: 'a.png', size: MAX_COVER_BYTES })).toBeNull();
    expect(coverUploadProblem({ name: 'a.png', size: MAX_COVER_BYTES + 1 })).toBe('CoverUploadTooLarge');
  });

  it('accepts every extension the host stores, whatever the casing', () => {
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.PNG'])
      expect(coverUploadProblem({ name, size: 1024 })).toBeNull();
  });

  it('refuses anything else, including a file with no extension', () => {
    expect(coverUploadProblem({ name: 'a.tiff', size: 1024 })).toBe('CoverUploadUnsupported');
    expect(coverUploadProblem({ name: 'a.pdf', size: 1024 })).toBe('CoverUploadUnsupported');
    expect(coverUploadProblem({ name: 'cover', size: 1024 })).toBe('CoverUploadUnsupported');
  });

  it('reports the size first, so an oversized image is not blamed on its type', () => {
    expect(coverUploadProblem({ name: 'a.tiff', size: MAX_COVER_BYTES + 1 })).toBe('CoverUploadTooLarge');
  });
});

describe('uploadCover', () => {
  it('returns the minted id as a cover token', async () => {
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
    expect(await uploadCover(file)).toBe('asset:new.png');
  });
});
