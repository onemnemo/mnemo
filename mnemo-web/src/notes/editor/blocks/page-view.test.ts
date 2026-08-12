// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { pageBlockView } from './page-view';
import type {
  BlockShellHost,
  EditorServices,
  NoteReferenceServices,
  RealizedBlockViewArgs,
} from '../registry/types';

const { schema } = createEditorSchema();

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };

function pageNode(referenceNoteId: string): PMNode {
  return schema.nodes.page.create({ referenceNoteId }, schema.nodes.line.create());
}

/**
 * A note library under the test's control, so the three states are reached
 * deliberately rather than by racing a fetch.
 */
function library(titles: Record<string, string> | null, emoji: Record<string, string> = {}) {
  const listeners = new Set<() => void>();
  let current = titles;
  let marks = emoji;
  const notes: NoteReferenceServices = {
    isLoaded: () => current !== null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    createChild: () => Promise.resolve('new-note'),
  };
  return {
    notes,
    resolve: (id: string) => current?.[id],
    resolveEmoji: (id: string) => marks[id],
    arrive(next: Record<string, string>, nextEmoji: Record<string, string> = {}) {
      current = next;
      marks = nextEmoji;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function mount(
  referenceNoteId: string,
  titles: Record<string, string> | null = {},
  emoji: Record<string, string> = {},
) {
  const lib = library(titles, emoji);
  const doc = schema.nodes.doc.create(null, [pageNode(referenceNoteId)]);
  const state = EditorState.create({ schema, doc });
  const view = {
    get state() {
      return state;
    },
    editable: true,
  } as unknown as EditorView;

  const services: EditorServices = {
    resolveNoteTitle: (id) => lib.resolve(id),
    resolveNoteEmoji: (id) => lib.resolveEmoji(id),
    notes: lib.notes,
    loadAssetUrl: () => Promise.reject(new Error('none')),
    uploadAsset: () => Promise.reject(new Error('none')),
  };

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    services,
  };
  return { realized: pageBlockView(args), lib };
}

function titleOf(realized: { dom: HTMLElement }): string {
  return realized.dom.querySelector('.notes-page-row-title')!.textContent ?? '';
}

function markOf(realized: { dom: HTMLElement }): HTMLElement {
  return realized.dom.querySelector('.notes-page-row-mark')!;
}

afterEach(() => {
  window.location.hash = '';
});

describe('page block NodeView', () => {
  it('draws a mark and a title, and links to the referenced note', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' });
    expect(realized.dom.tagName).toBe('A');
    expect(realized.dom.getAttribute('contenteditable')).toBe('false');
    expect(realized.dom.getAttribute('data-page-state')).toBe('ready');
    expect(realized.dom.getAttribute('href')).toBe('#/notes/note-1');
    expect(titleOf(realized)).toBe('Chapter one');
    // The mark is the row's own chrome, never editable content.
    expect(realized.contentDOM).toBeUndefined();
    expect(markOf(realized).querySelector('svg')).not.toBeNull();
  });

  it('leaves the row to the mark and the title alone', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' });
    expect(realized.dom.children).toHaveLength(2);
    expect(realized.dom.textContent).toBe('Chapter one');
  });

  it('shows the note own emoji in place of the document icon', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' }, { 'note-1': '📉' });
    expect(markOf(realized).textContent).toBe('📉');
    expect(markOf(realized).querySelector('svg')).toBeNull();
  });

  it('falls back to the document icon when the note carries no emoji', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' }, { 'note-1': '  ' });
    expect(markOf(realized).querySelector('svg')).not.toBeNull();
  });

  it('swaps the icon for an emoji added after the row was built', () => {
    const { realized, lib } = mount('note-1', { 'note-1': 'Chapter one' });
    expect(markOf(realized).querySelector('svg')).not.toBeNull();
    lib.arrive({ 'note-1': 'Chapter one' }, { 'note-1': '💊' });
    expect(markOf(realized).textContent).toBe('💊');
    expect(markOf(realized).querySelector('svg')).toBeNull();
  });

  it('reads a note with no title as untitled, not as missing', () => {
    const { realized } = mount('note-1', { 'note-1': '   ' });
    expect(realized.dom.getAttribute('data-page-state')).toBe('ready');
    expect(titleOf(realized)).toBe('PageUntitled');
  });

  it('says the note is gone only once the library has answered', () => {
    const { realized } = mount('note-gone', {});
    expect(realized.dom.getAttribute('data-page-state')).toBe('missing');
    expect(titleOf(realized)).toBe('PageMissingTitle');
    // Nothing to open: a missing card is not a link.
    expect(realized.dom.hasAttribute('href')).toBe(false);
  });

  it('waits rather than claiming a note is missing while the library is in flight', () => {
    const { realized, lib } = mount('note-1', null);
    expect(realized.dom.getAttribute('data-page-state')).toBe('resolving');
    expect(titleOf(realized)).toBe('');

    lib.arrive({ 'note-1': 'Chapter one' });
    expect(realized.dom.getAttribute('data-page-state')).toBe('ready');
    expect(titleOf(realized)).toBe('Chapter one');
  });

  it('follows a later rename without a transaction', () => {
    const { realized, lib } = mount('note-1', { 'note-1': 'Old name' });
    lib.arrive({ 'note-1': 'New name' });
    expect(titleOf(realized)).toBe('New name');
  });

  it('treats an empty reference as missing rather than routing nowhere', () => {
    const { realized } = mount('');
    expect(realized.dom.getAttribute('data-page-state')).toBe('missing');
    realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(window.location.hash).toBe('');
  });

  it('navigates on click and on Enter, and stops the browser following the link', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    realized.dom.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('#/notes/note-1');

    window.location.hash = '';
    realized.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(window.location.hash).toBe('#/notes/note-1');
  });

  it('does not navigate from a missing card', () => {
    const { realized } = mount('note-gone', {});
    realized.dom.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(window.location.hash).toBe('');
  });

  it('refuses an update to a different node type', () => {
    const { realized } = mount('note-1', { 'note-1': 'Chapter one' });
    const para = schema.nodes.paragraph.create(null, schema.nodes.line.create());
    expect(realized.update!(para)).toBe(false);
  });

  it('redraws in place when the reference changes', () => {
    const { realized } = mount('note-1', { 'note-1': 'One' });
    expect(realized.update!(pageNode('note-gone'))).toBe(true);
    expect(realized.dom.getAttribute('data-page-state')).toBe('missing');
  });

  it('lets go of the library when the view is destroyed', () => {
    const { realized, lib } = mount('note-1', { 'note-1': 'One' });
    expect(lib.listenerCount()).toBe(1);
    realized.destroy!();
    expect(lib.listenerCount()).toBe(0);
  });

  it('owns everything inside itself except the selection', () => {
    const { realized } = mount('note-1', { 'note-1': 'One' });
    const attrs = { type: 'attributes', target: realized.dom } as unknown as MutationRecord;
    const selection = { type: 'selection', target: realized.dom } as const;
    expect(realized.ignoreMutation!(attrs)).toBe(true);
    expect(realized.ignoreMutation!(selection)).toBe(false);
  });
});
