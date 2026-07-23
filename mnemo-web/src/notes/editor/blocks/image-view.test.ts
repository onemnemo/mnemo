// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { imageView } from './image-view';
import type { BlockShellHost, EditorServices, RealizedBlockViewArgs } from '../registry/types';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function image(attrs: Record<string, unknown>, caption?: string): PMNode {
  return schema.nodes.image.create(attrs, line(caption));
}

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };

function mountImage(
  attrs: Record<string, unknown>,
  options: { editable?: boolean; load?: EditorServices['loadAssetUrl'] } = {},
) {
  const doc = schema.nodes.doc.create(null, [image(attrs)]);
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    editable: options.editable ?? true,
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const load = options.load ?? ((path: string) => Promise.resolve(`blob:fake/${path}`));
  const loadCalls: string[] = [];
  const services: EditorServices = {
    resolveNoteTitle: () => undefined,
    loadAssetUrl: (path) => {
      loadCalls.push(path);
      return load(path);
    },
    uploadAsset: () => Promise.reject(new Error('unused')),
  };

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    services,
  };
  const realized = imageView(args);
  return { realized, dispatched, loadCalls, currentState: () => state };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('image NodeView', () => {
  it('renders an empty block as a placeholder card with the caption as content', () => {
    const { realized, loadCalls } = mountImage({ path: '' });
    expect(realized.dom.tagName).toBe('FIGURE');
    expect(realized.dom.getAttribute('data-image')).toBe('');
    expect(realized.dom.querySelector('.notes-image-card-placeholder')).not.toBeNull();
    expect(realized.contentDOM).toBe(realized.dom.querySelector('.notes-image-caption'));
    expect(realized.dom.querySelector('.notes-image-media')!.getAttribute('contenteditable')).toBe('false');
    // Nothing to fetch for an empty reference.
    expect(loadCalls).toHaveLength(0);
  });

  it('loads the bytes and shows the image with its stored width and alignment', async () => {
    const { realized } = mountImage({ path: 'aaaa.png', width: 320, align: 'center' });
    await flush();
    const img = realized.dom.querySelector('img')!;
    expect(img.src).toContain('blob:fake/aaaa.png');
    expect(img.style.width).toBe('320px');
    expect(realized.dom.getAttribute('data-align')).toBe('center');
    // The editable chrome hangs off the frame once the bytes are up.
    expect(realized.dom.querySelector('.notes-image-resize')).not.toBeNull();
    expect(realized.dom.querySelectorAll('.notes-image-align')).toHaveLength(3);
  });

  it('shows a labeled missing card when the reference does not resolve', async () => {
    const { realized } = mountImage(
      { path: 'attachment:cafe01:diagram.png' },
      { load: () => Promise.reject(new Error('404')) },
    );
    await flush();
    const card = realized.dom.querySelector('.notes-image-card-missing')!;
    expect(card).not.toBeNull();
    // The human-recognizable filename out of the legacy reference, and the stored
    // reference itself stays untouched in the document.
    expect(card.querySelector('.notes-image-card-detail')!.textContent).toBe('diagram.png');
    expect(realized.dom.getAttribute('data-image')).toBe('attachment:cafe01:diagram.png');
  });

  it('hides the editing chrome in a read-only view', async () => {
    const { realized } = mountImage({ path: 'aaaa.png' }, { editable: false });
    await flush();
    expect(realized.dom.querySelector('img')).not.toBeNull();
    expect(realized.dom.querySelector('.notes-image-resize')).toBeNull();
    expect(realized.dom.querySelectorAll('.notes-image-align')).toHaveLength(0);
  });

  it('reloads the bytes when the path changes and applies attrs in place otherwise', async () => {
    const { realized, loadCalls } = mountImage({ path: 'aaaa.png', width: 200 });
    await flush();
    expect(loadCalls).toEqual(['aaaa.png']);

    // Same path, new width: no refetch, the img is restyled in place.
    expect(realized.update!(image({ path: 'aaaa.png', width: 480 }))).toBe(true);
    expect(loadCalls).toEqual(['aaaa.png']);
    expect(realized.dom.querySelector('img')!.style.width).toBe('480px');

    // New path: a fresh fetch.
    expect(realized.update!(image({ path: 'bbbb.png' }))).toBe(true);
    await flush();
    expect(loadCalls).toEqual(['aaaa.png', 'bbbb.png']);
  });

  it('refuses an update to a different node type', () => {
    const { realized } = mountImage({ path: '' });
    const para = schema.nodes.paragraph.create(null, line('x'));
    expect(realized.update!(para)).toBe(false);
  });

  it('commits an alignment click as one transaction', async () => {
    const { realized, dispatched, currentState } = mountImage({ path: 'aaaa.png' });
    await flush();
    const buttons = realized.dom.querySelectorAll('.notes-image-align');
    buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dispatched).toHaveLength(1);
    expect(currentState().doc.firstChild!.attrs.align).toBe('center');
  });

  it('commits a resize drag as one transaction with the released width', async () => {
    const { realized, dispatched, currentState } = mountImage({ path: 'aaaa.png' });
    await flush();
    const pill = realized.dom.querySelector('.notes-image-resize')!;
    // jsdom draws nothing, so the drag starts from width 0 and the clamp floor applies.
    pill.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 180 }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 260 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 260 }));
    expect(dispatched).toHaveLength(1);
    expect(currentState().doc.firstChild!.attrs.width).toBe(160);
  });

  it('restores the stored width when the drag is cancelled', async () => {
    const { realized, dispatched } = mountImage({ path: 'aaaa.png', width: 300 });
    await flush();
    const pill = realized.dom.querySelector('.notes-image-resize')!;
    const img = realized.dom.querySelector('img')!;
    pill.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }));
    window.dispatchEvent(new MouseEvent('pointercancel', {}));
    expect(dispatched).toHaveLength(0);
    expect(img.style.width).toBe('300px');
  });

  it('owns the media and its own attribute writes, never the caption', () => {
    const { realized } = mountImage({ path: '' });
    const media = realized.dom.querySelector('.notes-image-media')!;
    const attrOnFigure = { type: 'attributes', target: realized.dom } as unknown as MutationRecord;
    const insideMedia = { type: 'childList', target: media } as unknown as MutationRecord;
    const inCaption = { type: 'characterData', target: realized.contentDOM! } as unknown as MutationRecord;
    const selection = { type: 'selection', target: realized.contentDOM! } as const;
    expect(realized.ignoreMutation!(attrOnFigure)).toBe(true);
    expect(realized.ignoreMutation!(insideMedia)).toBe(true);
    expect(realized.ignoreMutation!(inCaption)).toBe(false);
    expect(realized.ignoreMutation!(selection)).toBe(false);
  });

  it('drops a stale fetch that resolves after the path moved on', async () => {
    const loads: Array<(url: string) => void> = [];
    const { realized } = mountImage(
      { path: 'aaaa.png' },
      {
        load: () =>
          new Promise<string>((resolve) => {
            loads.push(resolve);
          }),
      },
    );
    realized.update!(image({ path: 'bbbb.png' }));
    loads[1]('blob:fake/second');
    // The first fetch answers late; its result must not clobber the newer path's.
    loads[0]('blob:fake/first');
    await flush();
    expect(realized.dom.querySelector('img')!.src).toContain('blob:fake/second');
  });
});
