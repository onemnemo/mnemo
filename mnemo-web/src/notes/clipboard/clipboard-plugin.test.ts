// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionKey, blockSelectionPlugin } from '../selection/block-selection-plugin';
import { clipboardPlugin } from './clipboard-plugin';
import { clearStashedSlice, readStashedSlice } from './internal-buffer';
import { MNEMO_CLIPBOARD_MIME, MNEMO_NONCE_ATTR } from './write-clipboard';

const { schema, registry, inline } = createEditorSchema();
const plugin = clipboardPlugin(registry, inline);

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const views: EditorView[] = [];

function mount(doc: PMNode, sids?: readonly string[]): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ schema, doc, plugins: [blockSelectionPlugin(registry), plugin] }),
  });
  views.push(view);
  if (sids && sids.length > 0) {
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(sids), anchorSid: sids[0] },
      }),
    );
  }
  return view;
}

function fakeClipboard(): DataTransfer & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    setData: (type: string, data: string) => store.set(type, data),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer & { store: Map<string, string> };
}

function fire(view: EditorView, kind: 'copy' | 'cut'): { data: DataTransfer & { store: Map<string, string> }; prevented: boolean; handled: boolean } {
  const data = fakeClipboard();
  let prevented = false;
  const event = { clipboardData: data, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
  const handler = plugin.props.handleDOMEvents![kind]!;
  const handled = Boolean((handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(plugin, view, event));
  return { data, prevented, handled };
}

const nonceOf = (html: string): string | undefined =>
  new RegExp(`${MNEMO_NONCE_ATTR}="([^"]+)"`).exec(html)?.[1];

describe('clipboardPlugin copy/cut', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  it('writes three fidelity tiers and stashes the exact slice under the nonce', () => {
    const view = mount(docOf(para('one', 's1'), para('two', 's2')), ['s1']);
    const { data, prevented, handled } = fire(view, 'copy');

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    const html = data.getData('text/html');
    expect(html).toContain(MNEMO_NONCE_ATTR);
    expect(data.getData('text/plain')).toBe('one');
    // The private MIME carries the same payload as the HTML fallback.
    expect(data.getData(MNEMO_CLIPBOARD_MIME)).toBe(html);

    const nonce = nonceOf(html);
    expect(nonce).toBeTruthy();
    const stashed = readStashedSlice(nonce!);
    expect(stashed?.mode).toBe('blocks');
    expect(stashed?.slice.content.child(0).attrs.sid).toBe('s1');
  });

  it('copies dispatches no document change', () => {
    const view = mount(docOf(para('one', 's1')), ['s1']);
    const before = view.state.doc;
    fire(view, 'copy');
    expect(view.state.doc).toBe(before);
  });

  it('cut writes the payload and then deletes the selected block as one step', () => {
    const view = mount(docOf(para('one', 's1'), para('two', 's2')), ['s1']);
    const { data, handled } = fire(view, 'cut');

    expect(handled).toBe(true);
    expect(data.getData('text/plain')).toBe('one');
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.child(0).attrs.sid).toBe('s2');
  });

  it('declines when there is nothing to copy', () => {
    const view = mount(docOf(para('', 's1')));
    const { handled, prevented } = fire(view, 'copy');
    expect(handled).toBe(false);
    expect(prevented).toBe(false);
  });
});
