// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState, editorPlugins } from '../edit/build-edit-state';
import { createEditorSchema } from '../editor/schema';
import { block, span } from '../editor/mapper/fixtures';
import type { BlockRegistry } from '../editor/registry/build';
import { blockChildrenOf } from '../editor/blocks/shared';
import { orderedSids, selectAll, selectSingle, type BlockSelection } from './block-selection';
import { blockSelectionKey, getBlockSelection } from './block-selection-plugin';
import { buildDeleteSelected } from './delete-selected';

type Blocks = Parameters<typeof buildNoteEditState>[0];

function mount(blocks: Blocks): { state: EditorState; registry: BlockRegistry } {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return { state: built.state, registry: built.registry };
}

function three(): { state: EditorState; registry: BlockRegistry } {
  return mount([
    block('Text', [span('one')]),
    block('Text', [span('two')]),
    block('Text', [span('three')]),
  ]);
}

function set(state: EditorState, selection: BlockSelection): EditorState {
  return state.apply(state.tr.setMeta(blockSelectionKey, { type: 'set', selection }));
}

function decorationCount(state: EditorState): number {
  return getBlockSelection(state).decorations.find().length;
}

describe('block-selection plugin reducer', () => {
  it('a set meta stores the selection and paints one decoration per block', () => {
    const { state, registry } = three();
    const next = set(state, selectAll(orderedSids(state.doc, registry)));
    expect(getBlockSelection(next).selected.size).toBe(3);
    expect(decorationCount(next)).toBe(3);
  });

  it('a clear meta empties the selection', () => {
    const { state, registry } = three();
    const selected = set(state, selectAll(orderedSids(state.doc, registry)));
    const cleared = selected.apply(selected.tr.setMeta(blockSelectionKey, { type: 'clear' }));
    expect(getBlockSelection(cleared).selected.size).toBe(0);
    expect(decorationCount(cleared)).toBe(0);
  });

  it('a document change drops the selection', () => {
    const { state, registry } = three();
    const selected = set(state, selectAll(orderedSids(state.doc, registry)));
    const edited = selected.apply(selected.tr.insertText('x', 1));
    expect(getBlockSelection(edited).selected.size).toBe(0);
  });

  it('a deliberate caret move drops the selection', () => {
    const { state, registry } = three();
    const selected = set(state, selectAll(orderedSids(state.doc, registry)));
    const moved = selected.apply(selected.tr.setSelection(TextSelection.create(selected.doc, 1)));
    expect(getBlockSelection(moved).selected.size).toBe(0);
  });

  it('a view-only transaction that neither edits nor moves the caret keeps the selection', () => {
    const { state, registry } = three();
    const selected = set(state, selectAll(orderedSids(state.doc, registry)));
    const stillSelected = selected.apply(selected.tr.setMeta('unrelated-view-only', true));
    expect(getBlockSelection(stillSelected).selected.size).toBe(3);
    expect(decorationCount(stillSelected)).toBe(3);
  });
});

describe('buildDeleteSelected', () => {
  it('removes only the selected blocks', () => {
    const { state, registry } = three();
    const order = orderedSids(state.doc, registry);
    const tr = buildDeleteSelected(state, registry, new Set([order[0], order[2]]))!;
    const next = state.apply(tr);
    const texts: string[] = [];
    next.doc.forEach((node) => texts.push(node.textContent));
    expect(texts).toEqual(['two']);
    // The edit dropped the selection.
    expect(getBlockSelection(next).selected.size).toBe(0);
  });

  it('never empties the document: deleting everything leaves one empty block', () => {
    const { state, registry } = three();
    const tr = buildDeleteSelected(state, registry, new Set(orderedSids(state.doc, registry)))!;
    const next = state.apply(tr);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(0).textContent).toBe('');
  });

  it('returns null when nothing is selected', () => {
    const { state, registry } = three();
    expect(buildDeleteSelected(state, registry, new Set())).toBeNull();
  });

  it('deleting a block inside a column reseeds the cell instead of leaving it empty', () => {
    const { state, registry } = mount([
      block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
        children: [
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [block('Text', [span('left')])] }),
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [block('Text', [span('right')])] }),
        ],
      }),
      block('Text', [span('below')]),
    ]);
    const order = orderedSids(state.doc, registry); // [left, right, below]
    const next = state.apply(buildDeleteSelected(state, registry, new Set([order[0]]))!);

    // The two-column row survives and the emptied left cell was reseeded with an
    // empty paragraph by the column-repair invariant, run inside the same apply.
    const twoColumn = next.doc.child(0);
    expect(twoColumn.type.name).toBe('twoColumn');
    const leftCell = twoColumn.child(1); // line, then the two columnGroups
    expect(leftCell.type.name).toBe('columnGroup');
    const leftChildren = blockChildrenOf(leftCell);
    expect(leftChildren.length).toBe(1);
    expect(leftChildren[0].type.name).toBe('paragraph');
    expect(leftChildren[0].textContent).toBe('');

    // The right cell and the trailing paragraph are untouched.
    const belowText = next.doc.child(next.doc.childCount - 1).textContent;
    expect(belowText).toBe('below');
  });
});

describe('buildDeleteSelected outermost coverage', () => {
  // Hand-built docs so nesting the flat wire fixtures cannot express is exact.
  const { schema, registry } = createEditorSchema();
  const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
  const para = (text: string, sid: string, ...children: PMNode[]) =>
    schema.nodes.paragraph.create({ sid, id: sid }, [line(text), ...children]);
  const column = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: 'col', id: 'col' }, [line(), ...blocks]);
  const mountDoc = (children: PMNode[]): EditorState =>
    EditorState.create({ schema, doc: schema.nodes.doc.create(null, children), plugins: editorPlugins(registry) });
  const texts = (state: EditorState): string[] => {
    const out: string[] = [];
    state.doc.forEach((node) => out.push(node.textContent));
    return out;
  };

  it('deletes a selected block whole even when it contains another selected block (no crash)', () => {
    // A paragraph nesting a paragraph: the flat-range delete would resolve a
    // stale outer position after removing the inner one and throw.
    const state = mountDoc([para('P', 'sP', para('C', 'sC')), para('Q', 'sQ')]);
    const next = state.apply(buildDeleteSelected(state, registry, new Set(['sP', 'sC']))!);
    expect(texts(next)).toEqual(['Q']);
  });

  it('deleting a nested parent takes its unselected child with it', () => {
    const state = mountDoc([para('P', 'sP', para('C', 'sC')), para('Q', 'sQ')]);
    const next = state.apply(buildDeleteSelected(state, registry, new Set(['sP']))!);
    expect(texts(next)).toEqual(['Q']);
  });

  it('deleting only a nested child leaves the parent', () => {
    const state = mountDoc([para('P', 'sP', para('C', 'sC')), para('Q', 'sQ')]);
    const next = state.apply(buildDeleteSelected(state, registry, new Set(['sC']))!);
    // Parent P survives with its own text and no block child.
    expect(next.doc.child(0).textContent).toBe('P');
    expect(blockChildrenOf(next.doc.child(0)).length).toBe(0);
    expect(next.doc.childCount).toBe(2);
  });

  it('deletes a two-column row whole when all its cells are selected', () => {
    const state = mountDoc([
      schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [line(), column(para('a', 'sA')), column(para('b', 'sB'))]),
      para('below', 'sBelow'),
    ]);
    const next = state.apply(buildDeleteSelected(state, registry, new Set(['sA', 'sB']))!);
    // The whole row is gone, not left as an empty two-column scaffold.
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(0).textContent).toBe('below');
  });

  it('select-all on a columns-only document yields one clean empty block', () => {
    const state = mountDoc([
      schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [line(), column(para('a', 'sA')), column(para('b', 'sB'))]),
    ]);
    const next = state.apply(buildDeleteSelected(state, registry, new Set(['sA', 'sB']))!);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.child(0).type.name).toBe('paragraph');
    expect(next.doc.child(0).textContent).toBe('');
  });
});

describe('selectSingle through the plugin', () => {
  it('a single-block set paints exactly one decoration', () => {
    const { state, registry } = three();
    const order = orderedSids(state.doc, registry);
    const next = set(state, selectSingle(order[1]));
    expect(getBlockSelection(next).selected).toEqual(new Set([order[1]]));
    expect(decorationCount(next)).toBe(1);
  });
});
