// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionKey, blockSelectionPlugin } from '../selection/block-selection-plugin';
import { buildCopySlice } from './copy';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const cell = (sid: string, ...blocks: PMNode[]) =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);
const twoColumn = (sid: string, left: PMNode, right: PMNode) =>
  schema.nodes.twoColumn.create({ sid, id: sid, splitRatio: 0.5 }, [line(), left, right]);
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

function selecting(doc: PMNode, sids?: readonly string[]): EditorState {
  let state = EditorState.create({ schema, doc, plugins: [blockSelectionPlugin(registry)] });
  if (sids && sids.length > 0) {
    state = state.apply(
      state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(sids), anchorSid: sids[0] },
      }),
    );
  }
  return state;
}

const sidsOf = (content: { childCount: number; child(i: number): PMNode }): string[] =>
  Array.from({ length: content.childCount }, (_unused, i) => String(content.child(i).attrs.sid));

describe('buildCopySlice', () => {
  it('copies a single selected block, keeping its sid', () => {
    const copy = buildCopySlice(selecting(docOf(para('one', 's1'), para('two', 's2')), ['s1']), registry);
    expect(copy?.mode).toBe('blocks');
    expect(copy?.slice.content.childCount).toBe(1);
    expect(sidsOf(copy!.slice.content)).toEqual(['s1']);
  });

  it('copies multiple selected blocks in document order regardless of selection order', () => {
    const copy = buildCopySlice(selecting(docOf(para('one', 's1'), para('two', 's2')), ['s2', 's1']), registry);
    expect(sidsOf(copy!.slice.content)).toEqual(['s1', 's2']);
  });

  it('copies a fully covered two-column row as one unit', () => {
    const doc = docOf(para('one', 's1'), twoColumn('tc', cell('cl', para('a', 'sA')), cell('cr', para('b', 'sB'))));
    const copy = buildCopySlice(selecting(doc, ['sA', 'sB']), registry);
    expect(copy?.slice.content.childCount).toBe(1);
    expect(copy?.slice.content.child(0).type.name).toBe('twoColumn');
  });

  it('copies only the covered leaf from a partly selected column', () => {
    const doc = docOf(twoColumn('tc', cell('cl', para('a', 'sA')), cell('cr', para('b', 'sB'))));
    const copy = buildCopySlice(selecting(doc, ['sA']), registry);
    expect(copy?.slice.content.childCount).toBe(1);
    expect(sidsOf(copy!.slice.content)).toEqual(['sA']);
  });

  it('falls back to the text selection when no block selection is live', () => {
    const state = selecting(docOf(para('hello', 's1')));
    const withText = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 7)));
    const copy = buildCopySlice(withText, registry);
    expect(copy?.mode).toBe('text');
    expect(copy?.slice.content.textBetween(0, copy!.slice.content.size, '\n')).toContain('hello');
  });

  it('copies nothing for an empty caret with no block selection', () => {
    expect(buildCopySlice(selecting(docOf(para('', 's1'))), registry)).toBeNull();
  });
});
