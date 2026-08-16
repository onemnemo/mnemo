// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAssetUrlCache } from './asset-cache';

describe('createAssetUrlCache', () => {
  const revoked: string[] = [];

  beforeEach(() => {
    revoked.length = 0;
    vi.stubGlobal('URL', {
      ...URL,
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches each reference once no matter how many views ask', async () => {
    let calls = 0;
    const cache = createAssetUrlCache((ref) => {
      calls++;
      return Promise.resolve(`blob:${ref}`);
    });

    const [a, b] = await Promise.all([cache.load('x.png'), cache.load('x.png')]);
    expect(a).toBe('blob:x.png');
    expect(b).toBe('blob:x.png');
    expect(calls).toBe(1);
  });

  it('forgets a failed load so a retry can attempt it again', async () => {
    let calls = 0;
    const cache = createAssetUrlCache((ref) => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(`blob:${ref}`);
    });

    await expect(cache.load('x.png')).rejects.toThrow('offline');
    await expect(cache.load('x.png')).resolves.toBe('blob:x.png');
    expect(calls).toBe(2);
  });

  it('revokes every handed-out URL on destroy and refuses further loads', async () => {
    const cache = createAssetUrlCache((ref) => Promise.resolve(`blob:${ref}`));
    await cache.load('a.png');
    await cache.load('b.png');

    cache.destroy();
    await Promise.resolve();
    expect(revoked.sort()).toEqual(['blob:a.png', 'blob:b.png']);
    await expect(cache.load('c.png')).rejects.toThrow();
  });

  it('revokes a load that settles only after destroy', async () => {
    let resolve: (url: string) => void = () => {};
    const cache = createAssetUrlCache(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const pending = cache.load('late.png');
    cache.destroy();
    resolve('blob:late');
    await expect(pending).rejects.toThrow();
    expect(revoked).toContain('blob:late');
  });
});
