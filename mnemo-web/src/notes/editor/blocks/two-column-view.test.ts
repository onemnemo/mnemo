// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { twoColumnView } from './two-column-view';
import type { BlockShellHost, EditorServices, RealizedBlockViewArgs } from '../registry/types';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function column(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(ratio: number): PMNode {
  return schema.nodes.twoColumn.create({ splitRatio: ratio }, [
    line(),
    column(para('a')),
    column(para('b')),
  ]);
}

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };
const services: EditorServices = {
  resolveNoteTitle: () => undefined,
  loadAssetUrl: () => Promise.reject(new Error('none')),
  uploadAsset: () => Promise.reject(new Error('none')),
};

function viewFor(node: PMNode) {
  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node,
    view: {} as EditorView, // never touched: the view renders and updates from the node alone
    getPos: () => 0,
    attrs: node.attrs,
    host,
    services,
  };
  return twoColumnView(args);
}

describe('two-column NodeView', () => {
  it('renders the same element toDOM produces, ratio split across both hooks', () => {
    const v = viewFor(twoColumn(0.5725));
    expect(v.dom.hasAttribute('data-two-column')).toBe(true);
    expect(v.dom.getAttribute('data-split')).toBe('0.5725');
    expect(v.dom.style.getPropertyValue('--notes-split')).toBe('0.5725');
    // The cells render into the element itself, exactly where toDOM put them.
    expect(v.contentDOM).toBe(v.dom);
  });

  it('normalizes the display variable without touching the stored attribute', () => {
    const v = viewFor(twoColumn(0));
    expect(v.dom.getAttribute('data-split')).toBe('0');
    expect(v.dom.style.getPropertyValue('--notes-split')).toBe('0.5');
  });

  it('updates the ratio in place rather than asking for a rebuild', () => {
    const v = viewFor(twoColumn(0.5));
    expect(v.update!(twoColumn(0.65))).toBe(true);
    expect(v.dom.getAttribute('data-split')).toBe('0.65');
    expect(v.dom.style.getPropertyValue('--notes-split')).toBe('0.65');
  });

  it('refuses an update to a different node type', () => {
    const v = viewFor(twoColumn(0.5));
    expect(v.update!(para('x'))).toBe(false);
  });

  it('owns attribute writes on its element and nothing else', () => {
    const v = viewFor(twoColumn(0.5));
    const attrOnSelf = { type: 'attributes', target: v.dom } as MutationRecord;
    const attrOnChild = { type: 'attributes', target: document.createElement('div') } as MutationRecord;
    const childList = { type: 'childList', target: v.dom } as MutationRecord;
    const selection = { type: 'selection', target: v.dom } as const;
    // The drag preview writes --notes-split on the container; that mutation is
    // ours and must not trigger a defensive redraw that kills the drag.
    expect(v.ignoreMutation!(attrOnSelf)).toBe(true);
    expect(v.ignoreMutation!(attrOnChild)).toBe(false);
    expect(v.ignoreMutation!(childList)).toBe(false);
    expect(v.ignoreMutation!(selection)).toBe(false);
  });
});
