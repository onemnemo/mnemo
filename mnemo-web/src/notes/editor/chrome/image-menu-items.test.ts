// @vitest-environment jsdom

/**
 * The rows a picture offers, and what they read off it.
 *
 * jsdom lays nothing out, so the column the size rows are fractions of is written onto the block's
 * element rather than measured. That is the point of the assertion: which pixel width a preset
 * commits, and which preset a stored width already counts as, are arithmetic over one measurement,
 * and both surfaces get them from here.
 */

import { describe, expect, it, vi } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { TranslateFn } from '@/i18n/types';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { blockSelectionKey } from '../../selection/block-selection-plugin';
import { block, span } from '../mapper/fixtures';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { locateBlock } from './block-commands';
import type { BlockMenuAction, BlockMenuChoice, BlockMenuEntry, BlockMenuVerb } from './block-menu-items';
import { imageMenuItems } from './image-menu-items';

/** Keys, not prose: a label assertion should fail on the wrong key, not the wrong wording. */
const t: TranslateFn = (_ns, key, params) =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

const services: EditorServices = {
  resolveNoteTitle: () => undefined,
  loadAssetUrl: (path) => Promise.resolve(`blob:fake/${path}`),
  uploadAsset: () => Promise.resolve('asset-1'),
};

interface Mounted {
  state: EditorState;
  registry: BlockRegistry;
  view: EditorView;
  dispatched: number;
  element: HTMLElement;
}

/**
 * One image block in a note, plus a fake view over it whose `nodeDOM` answers with a figure of
 * `figureWidth`, holding a frame of `frameWidth`, inside a column of `columnWidth`.
 *
 * The figure hugs its picture, so it is narrower than the column on purpose: a preset measured off
 * the figure would be a fraction of the picture the block already is rather than of the column.
 */
function mount(
  attrs: { path?: string; width?: number; align?: string; crop?: null } = {},
  layout: { columnWidth?: number; frameWidth?: number; figureWidth?: number } = {},
): Mounted {
  const built = buildNoteEditState([
    block('Text', [span('before')]),
    block('Image', [span('Fig 1')], {
      kind: 'image',
      path: attrs.path ?? 'a.png',
      alt: 'Fig 1',
      width: attrs.width ?? 0,
      align: attrs.align ?? 'left',
      crop: null,
    }),
  ]);
  if (!built.ok) throw new Error('fixture did not build');

  const column = document.createElement('div');
  const element = document.createElement('figure');
  const frame = document.createElement('div');
  frame.className = 'notes-image-frame';
  element.appendChild(frame);
  column.appendChild(element);
  column.getBoundingClientRect = () => new DOMRect(0, 0, layout.columnWidth ?? 0, 400);
  element.getBoundingClientRect = () => new DOMRect(0, 0, layout.figureWidth ?? layout.frameWidth ?? 0, 100);
  frame.getBoundingClientRect = () => new DOMRect(0, 0, layout.frameWidth ?? 0, 100);

  const mounted = {
    state: built.state,
    registry: built.registry,
    dispatched: 0,
    element,
  } as Mounted;

  mounted.view = {
    get state() {
      return mounted.state;
    },
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      mounted.dispatched += 1;
      mounted.state = mounted.state.apply(tr);
    },
    nodeDOM: () => element,
  } as unknown as EditorView;

  return mounted;
}

function imageAt(mounted: Mounted) {
  const pos = mounted.state.doc.child(0).nodeSize;
  const node = mounted.state.doc.child(1);
  return { pos, node, sid: String(node.attrs.sid ?? '') };
}

function items(mounted: Mounted, caption: { visible: boolean } | null = null): readonly BlockMenuEntry[] {
  const at = imageAt(mounted);
  return imageMenuItems({
    view: mounted.view,
    registry: mounted.registry,
    node: at.node,
    location: locateBlock(mounted.state, mounted.registry, at.pos, at.sid),
    services,
    t,
    caption: caption === null ? null : { visible: () => caption.visible, toggle: () => undefined },
  });
}

function submenu(entries: readonly BlockMenuEntry[], id: string): readonly BlockMenuChoice[] {
  const found = entries.find((entry) => entry.id === id);
  if (!found || found.kind !== 'submenu') throw new Error(`no submenu ${id}`);
  return found.items;
}

function action(entries: readonly BlockMenuChoice[], id: string): BlockMenuAction {
  const found = entries.find((entry) => entry.id === id);
  if (!found || found.kind !== 'action') throw new Error(`no action ${id}`);
  return found;
}

function verb(entries: readonly BlockMenuEntry[], id: string): BlockMenuVerb {
  const found = entries.find((entry) => entry.id === id);
  if (!found || found.kind !== 'verb') throw new Error(`no verb ${id}`);
  return found;
}

/** The same state with `sids` marked as a live block selection, the way block-menu-items tests it. */
function withSelection(state: EditorState, sids: string[]): EditorState {
  return state.apply(
    state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(sids), anchorSid: sids[0] ?? null },
    }),
  );
}

const checkedIds = (entries: readonly BlockMenuChoice[]) =>
  entries.filter((entry) => entry.kind === 'action' && entry.checked === true).map((entry) => entry.id);

describe('imageMenuItems', () => {
  it('offers the picture rows in one order, ending in a delete verb', () => {
    const entries = items(mount());
    expect(entries.map((entry) => entry.id)).toEqual([
      'image.replace',
      'image.crop',
      'image.caption',
      'image.sep.arrange',
      'image.align',
      'image.size',
      'image.sep.out',
      'image.copy',
      'image.download',
      'image.sep.delete',
      'delete',
    ]);
    const remove = entries.at(-1);
    expect(remove?.kind).toBe('verb');
    if (remove?.kind !== 'verb') return;
    expect(remove.label).toBe('ImageFlyoutDelete');
    expect(remove.danger).toBe(true);
  });

  it('gives every entry a unique id', () => {
    const entries = items(mount());
    const ids = [
      ...entries.map((entry) => entry.id),
      ...submenu(entries, 'image.align').map((entry) => entry.id),
      ...submenu(entries, 'image.size').map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ticks the alignment the block already has', () => {
    expect(checkedIds(submenu(items(mount()), 'image.align'))).toEqual(['image.align.left']);
    expect(checkedIds(submenu(items(mount({ align: 'right' })), 'image.align'))).toEqual([
      'image.align.right',
    ]);
  });

  it('ticks the size preset a stored width is already at, against the measured column', () => {
    // Half of a 600px column, give or take the two percent a hand-dragged width lands within.
    const half = mount({ width: 300 }, { columnWidth: 600 });
    expect(checkedIds(submenu(items(half), 'image.size'))).toEqual(['image.size.half']);

    const nearlyHalf = mount({ width: 306 }, { columnWidth: 600 });
    expect(checkedIds(submenu(items(nearlyHalf), 'image.size'))).toEqual(['image.size.half']);

    // The same pixels in a narrower column are three quarters of it, and nothing else.
    const narrower = mount({ width: 300 }, { columnWidth: 400 });
    expect(checkedIds(submenu(items(narrower), 'image.size'))).toEqual(['image.size.three-quarters']);

    // A block that was never resized is at no preset at all.
    expect(checkedIds(submenu(items(mount({}, { columnWidth: 600 })), 'image.size'))).toEqual([]);
  });

  it('commits a size preset as a fraction of the column measured at the click', () => {
    const mounted = mount({}, { columnWidth: 600 });
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    action(submenu(items(mounted), 'image.size'), 'image.size.three-quarters').run(mounted.view, loc);
    expect(mounted.dispatched).toBe(1);
    expect(mounted.state.doc.child(1).attrs.width).toBe(450);
  });

  it('measures the column and not the figure, which is only as wide as its picture', () => {
    // A 240px picture in a 600px column: the figure hugs it, so half is 300 and not 120, and the
    // stored 240 reads as no preset at all rather than as a full width.
    const mounted = mount({ width: 240 }, { columnWidth: 600, figureWidth: 240, frameWidth: 240 });
    expect(checkedIds(submenu(items(mounted), 'image.size'))).toEqual([]);

    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');
    action(submenu(items(mounted), 'image.size'), 'image.size.half').run(mounted.view, loc);
    expect(mounted.state.doc.child(1).attrs.width).toBe(300);

    // And a full width grows the picture to the column rather than leaving it where it was.
    action(submenu(items(mounted), 'image.size'), 'image.size.full').run(mounted.view, loc);
    expect(mounted.state.doc.child(1).attrs.width).toBe(600);
  });

  it('commits an alignment once, and not again when it is already there', () => {
    const mounted = mount();
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const rows = submenu(items(mounted), 'image.align');
    action(rows, 'image.align.left').run(mounted.view, loc);
    expect(mounted.dispatched).toBe(0);

    action(rows, 'image.align.center').run(mounted.view, loc);
    expect(mounted.dispatched).toBe(1);
    expect(mounted.state.doc.child(1).attrs.align).toBe('center');
  });

  it('reports the caption switch, and disables the row where no view lends one', () => {
    const entries = items(mount(), { visible: true });
    expect(action(entries as readonly BlockMenuChoice[], 'image.caption').checked).toBe(true);
    expect(action(items(mount(), { visible: false }) as readonly BlockMenuChoice[], 'image.caption').checked).toBe(
      false,
    );
    const orphaned = action(items(mount()) as readonly BlockMenuChoice[], 'image.caption');
    expect(orphaned.disabled).toBe(true);
    expect(orphaned.checked).toBe(false);
  });

  it('offers nothing to take out of the app for a block with no picture in it', () => {
    const entries = items(mount({ path: '' })) as readonly BlockMenuChoice[];
    expect(action(entries, 'image.crop').disabled).toBe(true);
    expect(action(entries, 'image.copy').disabled).toBe(true);
    expect(action(entries, 'image.download').disabled).toBe(true);
    // Replacing is exactly what an empty block is for.
    expect(action(entries, 'image.replace').disabled).toBeUndefined();
  });

  it('writes a fresh attrs object rather than the one the document is sharing', () => {
    const mounted = mount({}, { columnWidth: 600 });
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');
    const before = mounted.state.doc.child(1).attrs;

    action(submenu(items(mounted), 'image.size'), 'image.size.full').run(mounted.view, loc);
    expect(mounted.state.doc.child(1).attrs).not.toBe(before);
    expect(before.width).toBe(0);
  });

  it('leaves the note alone when the column cannot be measured', () => {
    const mounted = mount();
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');
    action(submenu(items(mounted), 'image.size'), 'image.size.half').run(mounted.view, loc);
    expect(mounted.dispatched).toBe(0);
  });

  it('names the size rows by the fraction they set', () => {
    expect(submenu(items(mount()), 'image.size').map((entry) => entry.label)).toEqual([
      'ImageSizeFormat(25)',
      'ImageSizeFormat(50)',
      'ImageSizeFormat(75)',
      'ImageSizeFormat(100)',
    ]);
  });
});

describe('imageMenuItems delete inside a selection', () => {
  it('names the count and deletes the whole selection when the picture sits in a multi-block selection', () => {
    const mounted = mount();
    const at = imageAt(mounted);
    const beforeSid = String(mounted.state.doc.child(0).attrs.sid ?? '');
    mounted.state = withSelection(mounted.state, [beforeSid, at.sid]);

    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');
    const row = verb(items(mounted), 'delete');
    expect(row.label).toBe('DeleteBlocksFormat(2)');
    // The selection announcer speaks the clear that follows, so this stays quiet rather than
    // doubling the live region.
    expect(row.announce).toBeNull();

    // The whole selection is gone, not just the picture that was right-clicked: a delete that
    // fell back to the single-block builder would have left the other selected block standing.
    const tr = row.build(mounted.state, loc);
    if (!tr) throw new Error('no transaction');
    const applied = mounted.state.apply(tr);
    expect(applied.doc.childCount).toBe(1);
    expect(applied.doc.child(0).type.name).toBe('paragraph');
  });

  it('leaves delete per-picture when the selection does not contain it', () => {
    const mounted = mount();
    const beforeSid = String(mounted.state.doc.child(0).attrs.sid ?? '');
    mounted.state = withSelection(mounted.state, [beforeSid]);

    const row = verb(items(mounted), 'delete');
    expect(row.label).toBe('ImageFlyoutDelete');
    expect(row.announce).toBe('BlockDeleted');
  });
});

describe('imageMenuItems crop', () => {
  it('commits a new window and the width the picture is already drawn at', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');

    // A crop of the left half, from a picture drawn 320px wide inside a 600px column.
    editImage.mockResolvedValue({ file: null, crop: { x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 } });
    const mounted = mount({}, { columnWidth: 600, frameWidth: 320 });
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: at.node,
      location: loc,
      services,
      t,
      caption: null,
    });
    await action(entries as readonly BlockMenuChoice[], 'image.crop').run(mounted.view, loc);

    const attrs = mounted.state.doc.child(1).attrs;
    expect(attrs.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 });
    // Without this the block would jump to the full column the moment it was cropped.
    expect(attrs.width).toBe(320);

    // Confirming the same window again is not an edit.
    const before = mounted.dispatched;
    const again = build({
      view: mounted.view,
      registry: mounted.registry,
      node: mounted.state.doc.child(1),
      location: locateBlock(mounted.state, mounted.registry, at.pos, at.sid),
      services,
      t,
      caption: null,
    });
    const live = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!live) throw new Error('no location');
    await action(again as readonly BlockMenuChoice[], 'image.crop').run(mounted.view, live);
    expect(mounted.dispatched).toBe(before);

    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });

  it('stores no crop at all for a window that keeps the whole picture', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');

    editImage.mockResolvedValue({ file: null, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1.5 } });
    const mounted = mount({ width: 200 }, { columnWidth: 600, frameWidth: 200 });
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: at.node,
      location: loc,
      services,
      t,
      caption: null,
    });
    await action(entries as readonly BlockMenuChoice[], 'image.crop').run(mounted.view, loc);
    expect(mounted.state.doc.child(1).attrs.crop).toBeNull();
    expect(mounted.state.doc.child(1).attrs.width).toBe(200);

    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });
});

describe('imageMenuItems replace and reframe failure paths', () => {
  it('toasts and leaves the block alone when the upload behind a replace fails', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');
    // resetModules gives image-menu-items.ts its own copy of the toast store, distinct from the
    // one this file imported before the reset, so the spy has to land on that same fresh copy.
    const { toast: freshToast } = await import('@/stores/toast');

    const file = new File(['x'], 'new.png', { type: 'image/png' });
    editImage.mockResolvedValue({ file, crop: { x: 0, y: 0, w: 1, h: 1, aspect: 1 } });
    const failingServices: EditorServices = { ...services, uploadAsset: () => Promise.reject(new Error('down')) };

    const mounted = mount();
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: at.node,
      location: loc,
      services: failingServices,
      t,
      caption: null,
    });

    const warn = vi.spyOn(freshToast, 'warning').mockImplementation(() => '');
    // Awaiting run() directly is what makes the pre-fix behaviour visible here: with no catch in
    // the action, this same await used to reject with the upload's own error instead of resolving.
    await action(entries as readonly BlockMenuChoice[], 'image.replace').run(mounted.view, loc);

    expect(warn).toHaveBeenCalledWith('ImageImportFailed');
    expect(mounted.dispatched).toBe(0);

    warn.mockRestore();
    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });

  it('toasts and leaves the block alone when the source behind a reframe cannot be loaded', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');
    const { toast: freshToast } = await import('@/stores/toast');

    const failingServices: EditorServices = { ...services, loadAssetUrl: () => Promise.reject(new Error('gone')) };

    const mounted = mount();
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: at.node,
      location: loc,
      services: failingServices,
      t,
      caption: null,
    });

    const warn = vi.spyOn(freshToast, 'warning').mockImplementation(() => '');
    await action(entries as readonly BlockMenuChoice[], 'image.crop').run(mounted.view, loc);

    expect(warn).toHaveBeenCalledWith('ImageEditorLoadFailed');
    // The dialog never opened: there was no source to show it.
    expect(editImage).not.toHaveBeenCalled();
    expect(mounted.dispatched).toBe(0);

    warn.mockRestore();
    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });

  it('toasts and leaves the block alone when the upload behind a reframe fails', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');
    const { toast: freshToast } = await import('@/stores/toast');

    const file = new File(['x'], 'new.png', { type: 'image/png' });
    editImage.mockResolvedValue({ file, crop: { x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 } });
    const failingServices: EditorServices = { ...services, uploadAsset: () => Promise.reject(new Error('down')) };

    const mounted = mount();
    const at = imageAt(mounted);
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: at.node,
      location: loc,
      services: failingServices,
      t,
      caption: null,
    });

    const warn = vi.spyOn(freshToast, 'warning').mockImplementation(() => '');
    await action(entries as readonly BlockMenuChoice[], 'image.crop').run(mounted.view, loc);

    expect(warn).toHaveBeenCalledWith('ImageImportFailed');
    expect(mounted.dispatched).toBe(0);

    warn.mockRestore();
    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });
});

describe('imageMenuItems replace', () => {
  it('commits the new path and window together, in one transaction, with no trace of the old crop', async () => {
    const editImage = vi.fn();
    vi.doMock('@/components/ui/image-editor/store', () => ({ editImage }));
    vi.resetModules();
    const { imageMenuItems: build } = await import('./image-menu-items');

    // Drawn 400px wide inside a 600px column, and already cropped from before the replace: a
    // correct replace has to discard this rather than carry it onto the new picture.
    const mounted = mount({}, { columnWidth: 600, frameWidth: 400 });
    const at = imageAt(mounted);
    const oldCrop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5, aspect: 1 };
    mounted.state = mounted.state.apply(
      mounted.state.tr.setNodeMarkup(at.pos, undefined, {
        ...mounted.state.doc.child(1).attrs,
        crop: oldCrop,
      }),
    );
    const loc = locateBlock(mounted.state, mounted.registry, at.pos, at.sid);
    if (!loc) throw new Error('no location');

    const file = new File(['x'], 'new.png', { type: 'image/png' });
    editImage.mockResolvedValue({ file, crop: { x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 } });

    const entries = build({
      view: mounted.view,
      registry: mounted.registry,
      node: loc.node,
      location: loc,
      services,
      t,
      caption: null,
    });

    const before = mounted.dispatched;
    await action(entries as readonly BlockMenuChoice[], 'image.replace').run(mounted.view, loc);

    // One dispatch: the path and the crop it replaces land together, so no intermediate state
    // ever draws the new picture behind the old picture's window.
    expect(mounted.dispatched).toBe(before + 1);

    const attrs = mounted.state.doc.child(1).attrs;
    expect(attrs.path).toBe('asset-1');
    expect(attrs.crop).toEqual({ x: 0, y: 0, w: 0.5, h: 1, aspect: 0.5 });
    // No stored width yet, so the picture's own drawn width becomes its width, same as a crop.
    expect(attrs.width).toBe(400);

    vi.doUnmock('@/components/ui/image-editor/store');
    vi.resetModules();
  });
});
