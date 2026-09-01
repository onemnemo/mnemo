// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { takeImagePress } from '../chrome/image-press';
import { createPortalRegistry, type PortalRegistry } from '../view/portal-registry';
import { captionRevealFor } from './image-caption-reveal';
import { imageView } from './image-view';
import type { BlockShellHost, EditorServices, RealizedBlockViewArgs } from '../registry/types';

const { schema, registry } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function image(attrs: Record<string, unknown>, caption?: string): PMNode {
  return schema.nodes.image.create(attrs, line(caption));
}

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };

function mountImage(
  attrs: Record<string, unknown>,
  options: {
    editable?: boolean;
    load?: EditorServices['loadAssetUrl'];
    /** Present in the app, absent in a harness with no React tree to portal into. */
    portals?: PortalRegistry;
    caption?: string;
  } = {},
) {
  const doc = schema.nodes.doc.create(null, [image(attrs, options.caption)]);
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  let focused = 0;
  const view = {
    get state() {
      return state;
    },
    editable: options.editable ?? true,
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
    focus() {
      focused += 1;
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
    registry,
    portals: options.portals,
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
  return { realized, view, dispatched, loadCalls, currentState: () => state, focusCount: () => focused };
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
    const portals = createPortalRegistry();
    const { realized } = mountImage({ path: 'aaaa.png' }, { editable: false, portals });
    await flush();
    expect(realized.dom.querySelector('img')).not.toBeNull();
    expect(realized.dom.querySelector('.notes-image-resize')).toBeNull();
    expect(realized.dom.querySelector('.notes-image-chrome')).toBeNull();
    expect(portals.size).toBe(0);
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

  it('mounts the pill through the portal bridge, on the live frame', async () => {
    const portals = createPortalRegistry();
    const { realized } = mountImage({ path: 'aaaa.png' }, { portals });
    await flush();
    expect(portals.size).toBe(1);
    const mount = realized.dom.querySelector('.notes-image-chrome');
    expect(mount?.parentElement).toBe(realized.dom.querySelector('.notes-image-frame'));

    // A new window rebuilds the frame; the same mount has to end up on the new one rather than
    // being left behind on the old one or registered a second time.
    expect(realized.update!(image({ path: 'aaaa.png', crop: { x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 } }))).toBe(true);
    expect(portals.size).toBe(1);
    expect(realized.dom.querySelector('.notes-image-chrome')?.parentElement).toBe(
      realized.dom.querySelector('.notes-image-frame'),
    );

    // And a block whose media goes back to a card has nothing to hang the pill on.
    expect(realized.update!(image({ path: '' }))).toBe(true);
    await flush();
    expect(portals.size).toBe(0);

    realized.destroy!();
    expect(portals.size).toBe(0);
  });

  it('draws no pill where there is no React tree to portal into', async () => {
    const { realized } = mountImage({ path: 'aaaa.png' });
    await flush();
    expect(realized.dom.querySelector('.notes-image-chrome')).toBeNull();
    expect(realized.dom.querySelector('.notes-image-resize')).not.toBeNull();
  });

  it('selects the block on a press on the picture and takes focus back', async () => {
    // A sid, because the selection is a set of them and a block without one is not selectable.
    const { realized, dispatched, focusCount } = mountImage({ path: 'aaaa.png', sid: 's1' });
    await flush();
    const img = realized.dom.querySelector('img')!;
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(dispatched).toHaveLength(1);
    expect(focusCount()).toBe(1);
  });

  it('leaves the selection alone on a secondary press, and still names the block it landed on', async () => {
    const { realized, dispatched, focusCount } = mountImage({ path: 'aaaa.png', sid: 's1' });
    await flush();
    // The slot is module state, so anything a previous test armed would answer for this one.
    takeImagePress();
    const img = realized.dom.querySelector('img')!;
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }));
    // Asking what a picture can do is not choosing it: nothing is selected and nothing is focused.
    expect(dispatched).toHaveLength(0);
    expect(focusCount()).toBe(0);
    // The menu reads the press instead, so it still knows which picture was pressed.
    expect(takeImagePress()?.sid).toBe('s1');
  });

  it('cancels the caret and the native drag a press on the picture would otherwise start', async () => {
    const { realized } = mountImage({ path: 'aaaa.png' });
    await flush();
    const img = realized.dom.querySelector('img')!;
    expect(img.draggable).toBe(false);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    img.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('leaves the placeholder card on click to pick, with no selection of its own', () => {
    const { realized, dispatched } = mountImage({ path: '' });
    const card = realized.dom.querySelector('.notes-image-card-placeholder')!;
    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    card.dispatchEvent(press);
    expect(dispatched).toHaveLength(0);
    expect(press.defaultPrevented).toBe(false);
  });

  it('clips an empty caption and keeps one that has text', () => {
    expect(mountImage({ path: 'aaaa.png' }).realized.dom.getAttribute('data-caption')).toBe('hidden');
    const written = mountImage({ path: 'aaaa.png' }, { caption: 'Figure 1' });
    expect(written.realized.dom.getAttribute('data-caption')).toBe('shown');
  });

  it('lends the caption switch out under the block sid, and takes it back on destroy', () => {
    const mounted = mountImage({ path: 'aaaa.png', sid: 's1' });
    const reveal = captionRevealFor(mounted.view, 's1');
    expect(reveal).not.toBeNull();
    expect(reveal?.visible()).toBe(false);

    reveal?.toggle();
    expect(mounted.realized.dom.getAttribute('data-caption')).toBe('shown');
    expect(reveal?.visible()).toBe(true);

    mounted.realized.destroy!();
    expect(captionRevealFor(mounted.view, 's1')).toBeNull();
  });

  it('takes the text with it when the caption is turned off, as one undo step', () => {
    const mounted = mountImage({ path: 'aaaa.png', sid: 's2' }, { caption: 'Figure 1' });
    const reveal = captionRevealFor(mounted.view, 's2');
    expect(reveal?.visible()).toBe(true);

    reveal?.toggle();
    expect(mounted.dispatched).toHaveLength(1);
    expect(mounted.currentState().doc.firstChild!.textContent).toBe('');
    expect(mounted.realized.dom.getAttribute('data-caption')).toBe('hidden');
    expect(reveal?.visible()).toBe(false);
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

  it('draws a crop as a shaped frame with the source offset behind it', async () => {
    // A window a quarter wide and an eighth tall, offset a quarter across and half down.
    const crop = { x: 0.25, y: 0.5, w: 0.25, h: 0.125, aspect: 2 };
    const { realized } = mountImage({ path: 'aaaa.png', crop });
    await flush();

    const frame = realized.dom.querySelector('.notes-image-frame') as HTMLElement;
    expect(frame.classList.contains('is-cropped')).toBe(true);
    // The CSSOM normalizes a bare ratio to its two-part form.
    expect(frame.style.aspectRatio).toBe('2 / 1');
    // Never resized, so the frame takes the column, matching the PDF export.
    expect(frame.style.width).toBe('100%');

    const img = realized.dom.querySelector('img')!;
    expect(img.style.width).toBe('400%');
    expect(img.style.height).toBe('800%');
    expect(img.style.left).toBe('-100%');
    expect(img.style.top).toBe('-400%');
  });

  it('writes a stored width to the frame under a crop and to the image without one', async () => {
    const cropped = mountImage({ path: 'aaaa.png', width: 300, crop: { x: 0, y: 0, w: 0.5, h: 0.5, aspect: 1 } });
    await flush();
    const frame = cropped.realized.dom.querySelector('.notes-image-frame') as HTMLElement;
    expect(frame.style.width).toBe('300px');
    // The inner layer's size belongs to the window; a px width there would move the crop.
    expect(cropped.realized.dom.querySelector('img')!.style.width).toBe('200%');

    const plain = mountImage({ path: 'aaaa.png', width: 300 });
    await flush();
    const plainFrame = plain.realized.dom.querySelector('.notes-image-frame') as HTMLElement;
    expect(plainFrame.classList.contains('is-cropped')).toBe(false);
    expect(plainFrame.style.width).toBe('');
    expect(plain.realized.dom.querySelector('img')!.style.width).toBe('300px');
  });

  it('resizes the frame, not the image, when there is a crop', async () => {
    const crop = { x: 0, y: 0, w: 0.5, h: 0.5, aspect: 1 };
    const { realized, dispatched, currentState } = mountImage({ path: 'aaaa.png', crop });
    await flush();
    const frame = realized.dom.querySelector('.notes-image-frame') as HTMLElement;
    const img = realized.dom.querySelector('img')!;

    const pill = realized.dom.querySelector('.notes-image-resize')!;
    // jsdom draws nothing, so the drag starts from width 0 and the clamp floor applies.
    pill.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 340 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 340 }));

    expect(dispatched).toHaveLength(1);
    expect(currentState().doc.firstChild!.attrs.width).toBe(240);
    expect(frame.style.width).toBe('240px');
    expect(img.style.width).toBe('200%');
  });

  it('rebuilds the media for a new crop without refetching the bytes', async () => {
    const { realized, loadCalls } = mountImage({ path: 'aaaa.png' });
    await flush();
    expect(realized.dom.querySelector('.notes-image-frame')!.classList.contains('is-cropped')).toBe(false);

    const crop = { x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 };
    expect(realized.update!(image({ path: 'aaaa.png', crop }))).toBe(true);
    expect(loadCalls).toEqual(['aaaa.png']);
    expect(realized.dom.querySelector('.notes-image-frame')!.classList.contains('is-cropped')).toBe(true);
    expect(realized.dom.querySelector('img')!.style.width).toBe('200%');

    // Same window again: nothing is rebuilt, so the element identity survives.
    const before = realized.dom.querySelector('img');
    expect(realized.update!(image({ path: 'aaaa.png', crop: { ...crop }, width: 200 }))).toBe(true);
    expect(realized.dom.querySelector('img')).toBe(before);

    expect(realized.update!(image({ path: 'aaaa.png' }))).toBe(true);
    expect(realized.dom.querySelector('.notes-image-frame')!.classList.contains('is-cropped')).toBe(false);
    expect(loadCalls).toEqual(['aaaa.png']);
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
