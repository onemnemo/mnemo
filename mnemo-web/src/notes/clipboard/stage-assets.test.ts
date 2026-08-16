// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import {
  collectStageablePaths,
  remapImagePaths,
  stageImageAssets,
  type PasteAssetSupport,
} from './stage-assets';

const { schema } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const image = (path: string) => schema.nodes.image.create({ path }, line('caption'));
const para = (text: string) => schema.nodes.paragraph.create(null, line(text));
const fragOf = (...nodes: PMNode[]) => Fragment.fromArray(nodes);

/** A support that resolves everything, capturing the files it is asked to upload. */
function fakeSupport(overrides: Partial<PasteAssetSupport> = {}): PasteAssetSupport & { uploaded: File[] } {
  const uploaded: File[] = [];
  return {
    uploaded,
    canStage: (path) => !path.startsWith('http'),
    loadBytes: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
    upload: (file) => {
      uploaded.push(file);
      return Promise.resolve(`new-${file.name}`);
    },
    ...overrides,
  };
}

describe('collectStageablePaths', () => {
  it('returns nothing without support', () => {
    expect(collectStageablePaths(fragOf(image('a.png')), undefined)).toEqual([]);
  });

  it('collects distinct resolvable image references in order', () => {
    const content = fragOf(image('a.png'), para('text'), image('b.png'), image('a.png'));
    expect(collectStageablePaths(content, fakeSupport())).toEqual(['a.png', 'b.png']);
  });

  it('skips references support cannot stage and empty ones', () => {
    const content = fragOf(image('http://remote/x.png'), image(''), image('keep.png'));
    expect(collectStageablePaths(content, fakeSupport())).toEqual(['keep.png']);
  });
});

describe('stageImageAssets', () => {
  it('re-uploads each reference to a fresh id', async () => {
    const support = fakeSupport();
    const map = await stageImageAssets(['a.png', 'b.png'], support, new AbortController().signal);
    expect(map.get('a.png')).toBe('new-image.png');
    expect(map.get('b.png')).toBe('new-image.png');
    expect(support.uploaded).toHaveLength(2);
  });

  it('names the upload file so its extension matches the fetched bytes', async () => {
    const support = fakeSupport({
      loadBytes: () => Promise.resolve(new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
    });
    await stageImageAssets(['photo.bin'], support, new AbortController().signal);
    expect(support.uploaded[0].name).toBe('image.jpg');
  });

  it('keeps the surviving images when one upload fails, dropping only the failure', async () => {
    // The PNG upload fails; the GIF succeeds. Distinct mime types give distinct
    // upload filenames, so the failing one can be singled out.
    const support = fakeSupport({
      loadBytes: (path) =>
        Promise.resolve(new Blob([new Uint8Array([1])], { type: path === 'a.png' ? 'image/png' : 'image/gif' })),
      upload: (file) =>
        file.name === 'image.png' ? Promise.reject(new Error('nope')) : Promise.resolve(`ok-${file.name}`),
    });
    const map = await stageImageAssets(['a.png', 'b.gif'], support, new AbortController().signal);
    expect(map.has('a.png')).toBe(false);
    expect(map.get('b.gif')).toBe('ok-image.gif');
  });

  it('drops an image whose bytes cannot be loaded', async () => {
    const support = fakeSupport({ loadBytes: () => Promise.reject(new Error('missing')) });
    const map = await stageImageAssets(['gone.png'], support, new AbortController().signal);
    expect(map.size).toBe(0);
  });

  it('reports progress as each image settles', async () => {
    const onStaged = vi.fn();
    await stageImageAssets(['a.png', 'b.png'], fakeSupport(), new AbortController().signal, onStaged);
    expect(onStaged.mock.calls).toEqual([[1], [2]]);
  });

  it('rejects the whole batch when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(stageImageAssets(['a.png'], fakeSupport(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('rejects when aborted mid-flight, before the next upload', async () => {
    const controller = new AbortController();
    const support = fakeSupport({
      upload: (file) => {
        controller.abort();
        return Promise.resolve(`new-${file.name}`);
      },
    });
    await expect(
      stageImageAssets(['a.png', 'b.png'], support, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('remapImagePaths', () => {
  it('swaps a mapped image path and leaves the rest untouched', () => {
    const content = fragOf(image('a.png'), para('text'), image('b.png'));
    const mapped = remapImagePaths(content, new Map([['a.png', 'new-a.png']]));

    expect(mapped.child(0).attrs.path).toBe('new-a.png');
    expect(mapped.child(0).firstChild?.textContent).toBe('caption'); // caption preserved
    expect(mapped.child(2).attrs.path).toBe('b.png'); // unmapped image unchanged
  });

  it('returns the same fragment for an empty map', () => {
    const content = fragOf(image('a.png'));
    expect(remapImagePaths(content, new Map())).toBe(content);
  });
});
