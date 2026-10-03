// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMarkdownSerializer } from '../mapper/serialize-markdown';
import { block, span } from '../mapper/fixtures';
import { editorSchema } from '../schema';
import { splitBlock, backspaceStructural, convertBlockType } from '../commands/structure';
import { indentTransaction } from '../commands/list-nesting';
import { moveBlockIntoCellTransaction } from '../chrome/block-move';
import { duplicateBlock, locateBlock } from '../chrome/block-commands';
import { parseMarkdownToBlocks } from '../../clipboard/markdown-blocks';
import { buildNoteReadState } from '../../read/build-state';
import { listNumberKey } from './list-numbers';
import type { Block } from '../../model/types';
import {
  caretIn,
  eightNineTen,
  expectUndoRedo,
  itemAt,
  labels,
  mount,
  move,
  numbered,
  run,
  starts,
  text,
} from './list-start-fixtures';

describe('a list that starts past one', () => {
  it('reads from a pasted markdown document, shows 8 and 9, and copies back out as 8 and 9', () => {
    const blocks = parseMarkdownToBlocks('# Steps\n\n8. eight\n9. nine');
    expect(blocks.map((b) => b.meta)).toEqual([{}, { listStart: 8 }, {}]);
    const { state, registry } = mount(blocks);

    expect(labels(state)).toEqual(['8', '9']);
    const md = createMarkdownSerializer(registry, editorSchema().inline).document(state.doc);
    expect(md.endsWith('\n\n8. eight\n9. nine')).toBe(true);
  });

  it('paints the same numbers in the read view', () => {
    const read = buildNoteReadState(eightNineTen());
    if (!read.ok) throw new Error('fixture did not build');
    const painted = listNumberKey.getState(read.state)!.decorations.find();
    expect(painted.map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-list-number'])).toEqual([
      '8',
      '9',
      '10',
    ]);
  });

  it('shows an old note whose items all store a number from 1, also once reordered', () => {
    const old = ['c', 'a', 'b'].map((value, k) =>
      block('NumberedList', [span(value)], { kind: 'empty' }, { meta: { listNumberIndex: k + 3, listNumber: `${String(k + 3)}.` } }),
    );
    const before = mount(old).state;
    expect(labels(before)).toEqual(['1', '2', '3']);
    const after = move(before, 'c', 2);
    expect(labels(after)).toEqual(['1', '2', '3']);
    expect(starts(after)).toEqual({});
    expectUndoRedo(before, after);
  });

  it('renumbers from the start when an item is split off in the middle', () => {
    let state = caretIn(mount(eightNineTen().slice(0, 2)).state, 'eight', 5);
    state = run(state, splitBlock);
    expect(labels(state)).toEqual(['8', '9', '10']);
    expect(starts(state)).toEqual({ eight: 8 });
  });

  it('keeps 8 on the new first item when Enter pushes one above, with one start in the run', () => {
    const before = mount(eightNineTen().slice(0, 2)).state;
    const after = run(caretIn(before, 'eight', 0), splitBlock);
    expect(labels(after)).toEqual(['8', '9', '10']);
    expect(starts(after)).toEqual({ '': 8 });
    expectUndoRedo(before, after);
  });

  it('starts at 9 when the first item is deleted', () => {
    const before = mount(eightNineTen()).state;
    const first = itemAt(before, 'eight');
    const after = before.apply(before.tr.delete(first.pos, first.pos + first.node.nodeSize));
    expect(labels(after)).toEqual(['9', '10']);
    expect(starts(after)).toEqual({ nine: 9 });
    expectUndoRedo(before, after);
  });

  it('starts at 10 when the first two items are deleted', () => {
    const before = mount(eightNineTen()).state;
    const first = itemAt(before, 'eight');
    const second = itemAt(before, 'nine');
    const after = before.apply(before.tr.delete(first.pos, second.pos + second.node.nodeSize));
    expect(labels(after)).toEqual(['10']);
  });

  it('starts at 9 when the first item is turned into text, and joins at 9 when turned back', () => {
    const before = mount(eightNineTen()).state;
    const eight = itemAt(before, 'eight');
    const asText = before.apply(convertBlockType(before.tr, eight.pos, eight.node, before.schema.nodes.paragraph));
    expect(labels(asText)).toEqual(['9', '10']);
    expect(starts(asText)).toEqual({ nine: 9 });
    expectUndoRedo(before, asText);

    const back = itemAt(asText, 'eight');
    const again = asText.apply(convertBlockType(asText.tr, back.pos, back.node, asText.schema.nodes.numberedItem));
    expect(labels(again)).toEqual(['9', '10', '11']);
    expect(starts(again)).toEqual({ eight: 9 });
  });

  it('renumbers from the start when an item is joined into the one above', () => {
    // The first Backspace turns the item into text, the second joins it.
    let state = run(caretIn(mount(eightNineTen()).state, 'nine', 0), backspaceStructural);
    state = run(state, backspaceStructural);
    expect(labels(state)).toEqual(['8', '9']);
    expect(itemAt(state, 'eightnine')).toBeTruthy();
  });

  it('gives an item dragged to the top the start of its run', () => {
    const before = mount(eightNineTen()).state;
    const after = move(before, 'ten', 0);
    expect(labels(after)).toEqual(['8', '9', '10']);
    expect(starts(after)).toEqual({ ten: 8 });
    expectUndoRedo(before, after);
  });

  it('keeps 8 when the first item is dragged further down its own list', () => {
    const before = mount(eightNineTen()).state;
    for (const to of [1, 2]) {
      const after = move(before, 'eight', to);
      expect(labels(after)).toEqual(['8', '9', '10']);
      expect(starts(after)).toEqual({ nine: 8 });
      expectUndoRedo(before, after);
    }
  });

  it('keeps 8 when the first two items are dragged together below the third', () => {
    const before = mount(eightNineTen()).state;
    const eight = itemAt(before, 'eight');
    const nine = itemAt(before, 'nine');
    const moved = before.doc.slice(eight.pos, nine.pos + nine.node.nodeSize).content;
    const tr = before.tr.delete(eight.pos, nine.pos + nine.node.nodeSize);
    tr.insert(tr.doc.content.size, moved);
    const after = before.apply(tr);
    expect(after.doc.firstChild!.firstChild!.textContent).toBe('ten');
    expect(labels(after)).toEqual(['8', '9', '10']);
    expect(starts(after)).toEqual({ ten: 8 });
    expectUndoRedo(before, after);
  });

  it('numbers an indented item from 1 under its new parent', () => {
    const before = mount(eightNineTen()).state;
    const nine = itemAt(before, 'nine');
    const state = before.apply(indentTransaction(before, nine.pos, nine.node)!);
    expect(labels(state)).toEqual(['8', 'a', '9']);
  });

  it('keeps one start when the first item is duplicated', () => {
    const built = mount(eightNineTen().slice(0, 2));
    const first = itemAt(built.state, 'eight');
    const loc = locateBlock(built.state, built.registry, first.pos, String(first.node.attrs.sid))!;
    const state = built.state.apply(duplicateBlock(built.state, loc));
    expect(labels(state)).toEqual(['8', '9', '10']);
    expect(Object.values(starts(state))).toEqual([8]);
  });

  it('keeps the start when the first item moves into a column, and the rest goes on from 9', () => {
    const blocks = [
      ...eightNineTen().slice(0, 2),
      block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
        children: [
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [text('a')] }),
          block('ColumnGroup', [span('')], { kind: 'empty' }, { children: [text('c')] }),
        ],
      }),
    ];
    const before = mount(blocks).state;
    const eight = itemAt(before, 'eight');
    let right: { pos: number; sid: string } | null = null;
    let cells = 0;
    before.doc.descendants((node, pos) => {
      if (node.type.name === 'columnGroup' && ++cells === 2) right = { pos, sid: String(node.attrs.sid) };
      return right === null;
    });
    const cell = right as unknown as { pos: number; sid: string };
    const state = before.apply(
      moveBlockIntoCellTransaction(before, eight.pos, String(eight.node.attrs.sid), cell.pos, cell.sid, 0)!,
    );
    expect(labels(state)).toEqual(['9', '8']);
  });

  it('gives a nested run under a bullet its own start', () => {
    const blocks = [block('BulletList', [span('a')], { kind: 'empty' }, { children: [numbered('x', 3), numbered('y')] })];
    expect(labels(mount(blocks).state)).toEqual(['c', 'd']);
  });

  it('starts at 1 when a block becomes a numbered item, whatever it stores', () => {
    const blocks = [block('Text', [span('para')], { kind: 'empty' }, { meta: { listStart: 5 } })];
    const before = mount(blocks).state;
    const state = before.apply(convertBlockType(before.tr, 0, before.doc.firstChild!, before.schema.nodes.numberedItem));
    expect(labels(state)).toEqual(['1']);
    expect(starts(state)).toEqual({});
  });

  it('keeps a start of 0 at decimal depth and counts from 1 under a letter label', () => {
    const blocks = [
      numbered('zero', 0),
      numbered('one'),
      block('BulletList', [span('b')], { kind: 'empty' }, { children: [numbered('x', 0), numbered('y')] }),
    ];
    expect(labels(mount(blocks).state)).toEqual(['0', '1', 'a', 'b']);
  });
});

describe('two runs meeting', () => {
  /** A list imported at 8, a paragraph, then a list typed in the editor. */
  function importedThenTyped(): Block[] {
    return [...eightNineTen(), text('gap'), numbered('one'), numbered('two'), numbered('three')];
  }

  it('lets the earlier start win when the paragraph between them is deleted', () => {
    const before = mount(importedThenTyped()).state;
    const gap = itemAt(before, 'gap');
    const after = before.apply(before.tr.delete(gap.pos, gap.pos + gap.node.nodeSize));
    expect(labels(after)).toEqual(['8', '9', '10', '11', '12', '13']);
    expect(starts(after)).toEqual({ eight: 8 });
    expectUndoRedo(before, after);
  });

  it('drops the start of a later run merged into an earlier one', () => {
    const blocks = [...eightNineTen(), text('gap'), numbered('five', 5), numbered('six')];
    const before = mount(blocks).state;
    const gap = itemAt(before, 'gap');
    const after = before.apply(before.tr.delete(gap.pos, gap.pos + gap.node.nodeSize));
    expect(labels(after)).toEqual(['8', '9', '10', '11', '12']);
    expect(starts(after)).toEqual({ eight: 8 });
    expectUndoRedo(before, after);
  });

  it('keeps the typed list at 1 and the imported rest at 9 when the imported head is dragged into the typed list', () => {
    const before = mount(importedThenTyped()).state;
    // Into the middle of the typed list, and onto its top.
    for (const [to, typed] of [
      [5, ['1', '2', '3', '4']],
      [3, ['1', '2', '3', '4']],
    ] as const) {
      const after = move(before, 'eight', to);
      expect(labels(after)).toEqual(['9', '10', ...typed]);
      expect(starts(after)).toEqual({ nine: 9 });
      expectUndoRedo(before, after);
    }
  });

  it('keeps the imported list at 8 when a typed item is dragged into it or onto its top', () => {
    const before = mount(importedThenTyped()).state;
    const into = move(before, 'two', 1);
    expect(labels(into)).toEqual(['8', '9', '10', '11', '1', '2']);
    expect(starts(into)).toEqual({ eight: 8 });
    expectUndoRedo(before, into);

    const onTop = move(before, 'one', 0);
    expect(labels(onTop)).toEqual(['8', '9', '10', '11', '1', '2']);
    expect(starts(onTop)).toEqual({ one: 8 });
    expectUndoRedo(before, onTop);
  });
});

describe('typing in a long numbered note', () => {
  it('appends nothing and maps the numbers rather than rebuilding them', () => {
    const before = caretIn(mount(eightNineTen()).state, 'nine', 4);
    const tr = before.tr.insertText('!');
    const { state, transactions } = before.applyTransaction(tr);
    expect(transactions).toHaveLength(1);
    expect(labels(state)).toEqual(['8', '9', '10']);
    expect(listNumberKey.getState(state)!.decorations.find().map((d) => d.from)).toEqual(
      listNumberKey.getState(before)!.decorations.find().map((d) => tr.mapping.map(d.from)),
    );
  });
});

describe('a run next to a nested run', () => {
  /** 8. eight with a sub-list of x and y, then 9. nine and 10. ten. */
  function eightWithSubList() {
    return [numbered('eight', 8, [numbered('x'), numbered('y')]), numbered('nine'), numbered('ten')];
  }

  it('starts at 9 when a first item that holds a sub-list is deleted', () => {
    const built = mount(eightWithSubList());
    const before = built.state;
    const eight = itemAt(before, 'eight');
    const after = before.apply(before.tr.delete(eight.pos, eight.pos + eight.node.nodeSize));
    expect(labels(after)).toEqual(['9', '10']);
    expect(starts(after)).toEqual({ nine: 9 });
    expect(createMarkdownSerializer(built.registry, editorSchema().inline).document(after.doc)).toBe('9. nine\n10. ten');
    expectUndoRedo(before, after);
  });

  it('starts at 9 when a first item that holds a sub-list is turned into text or a checklist', () => {
    const before = mount(eightWithSubList()).state;
    const eight = itemAt(before, 'eight');
    const asText = before.apply(convertBlockType(before.tr, eight.pos, eight.node, before.schema.nodes.paragraph));
    expect(labels(asText)).toEqual(['1', '2', '9', '10']);
    expect(starts(asText)).toEqual({ nine: 9 });
    expectUndoRedo(before, asText);

    const asChecklist = before.apply(convertBlockType(before.tr, eight.pos, eight.node, before.schema.nodes.checklistItem));
    expect(labels(asChecklist)).toEqual(['a', 'b', '9', '10']);
    expect(starts(asChecklist)).toEqual({ nine: 9 });
  });

  it('gives a typed item with a sub-list dragged onto an imported list the start, and leaves its sub-list alone', () => {
    const blocks = [
      ...eightNineTen(),
      text('gap'),
      numbered('one', undefined, [numbered('sub')]),
      numbered('two'),
    ];
    const before = mount(blocks).state;
    const after = move(before, 'one', 0);
    expect(labels(after)).toEqual(['8', 'a', '9', '10', '11', '1']);
    expect(starts(after)).toEqual({ one: 8 });
    expectUndoRedo(before, after);
  });
});
