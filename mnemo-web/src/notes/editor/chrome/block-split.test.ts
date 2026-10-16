// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { parseBlock, serializeBlock } from '../../model/wire';
import type { Block } from '../../model/types';
import { redo, undo } from '../history';
import { block, span } from '../mapper/fixtures';
import { createMarkdownSerializer } from '../mapper/serialize-markdown';
import { editorSchema } from '../schema';
import { splitBlockIntoColumnsTransaction } from './block-move';

const { registry, inline } = editorSchema();
const markdown = createMarkdownSerializer(registry, inline);

function mount(blocks: Block[]): { state: EditorState; fromDoc: (doc: PMNode) => Block[] } {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  return { state: built.state, fromDoc: (doc) => built.mapper.fromDoc(doc) };
}

const column = (...children: Block[]) => block('ColumnGroup', [span('')], { kind: 'empty' }, { children });
const layout = (left: Block[], right: Block[]) =>
  block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, { children: [column(...left), column(...right)] });

function wireTable(): Block {
  const cell = (text: string) => block('TableCell', [span(text)], { kind: 'tableCell', fill: '' });
  return block(
    'Table',
    [span('')],
    { kind: 'table', columnWidths: [120, 140], headerRows: [true, false], headerColumns: [false, false], fullWidth: false },
    {
      children: [
        block('TableRow', [span('')], { kind: 'empty' }, { children: [cell('h1'), cell('h2')] }),
        block('TableRow', [span('')], { kind: 'empty' }, { children: [cell('c1'), cell('c2')] }),
      ],
    },
  );
}

/** One block of every type that can sit on the page, each with text that names it. */
function everyType(): Block[] {
  return [
    block('Text', [span('text')]),
    block('Heading1', [span('heading')]),
    block('BulletList', [span('bullet')], { kind: 'empty' }, { children: [block('BulletList', [span('nested bullet')])] }),
    block('NumberedList', [span('numbered')]),
    block('Checklist', [span('check')], { kind: 'checklist', checked: true }),
    block('Quote', [span('quote')]),
    block('Code', [span('let x = 1;')], { kind: 'code', language: 'ts', source: 'let x = 1;', caption: 'cap' }),
    block('Image', [span('image caption')], {
      kind: 'image',
      path: 'attachment:abc',
      alt: 'alt',
      width: 400,
      align: 'center',
      crop: null,
    }),
    block('Equation', [span('')], { kind: 'equation', latex: 'E = mc^2' }),
    block('Page', [span('')], { kind: 'page', referenceNoteId: 'note-1' }),
    block('Sketch', [span('sketch')], { kind: 'sketch', width: 320, align: 'center' }),
    block('Callout', [span('callout')], { kind: 'callout', emoji: '!', tone: 'note' }),
    wireTable(),
    block('Divider', [span('')]),
  ];
}

interface Located {
  pos: number;
  sid: string;
  type: string;
}

function topLevel(state: EditorState): Located[] {
  const out: Located[] = [];
  state.doc.forEach((node, pos) => out.push({ pos, sid: String(node.attrs.sid), type: node.type.name }));
  return out;
}

/** The first block with this text at any depth, skipping lines and containers. */
function find(state: EditorState, text: string): Located {
  let found: Located | null = null;
  state.doc.descendants((node, pos) => {
    const block = node.type.name !== 'line' && node.attrs.sid && !node.isText;
    if (!found && block && !node.type.name.startsWith('table') && node.firstChild?.textContent === text) {
      found = { pos, sid: String(node.attrs.sid), type: node.type.name };
    }
    return !found;
  });
  if (!found) throw new Error(`no block "${text}"`);
  return found;
}

const containers = new Set(['twoColumn', 'columnGroup', 'line', 'tableRow']);

/** Every non-container block as `sid:type:own line text`, sorted. A loss or a duplicate shows in the diff. */
function leaves(state: EditorState): string[] {
  const out: string[] = [];
  state.doc.descendants((node) => {
    if (node.attrs.sid === undefined || containers.has(node.type.name)) return;
    out.push(`${String(node.attrs.sid)}:${node.type.name}:${node.firstChild?.textContent ?? ''}`);
  });
  return out.sort();
}

function applyHistory(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

function split(state: EditorState, source: Located, target: Located, side: 'left' | 'right') {
  return splitBlockIntoColumnsTransaction(state, source.pos, source.sid, target.pos, target.sid, side);
}

describe('splitBlockIntoColumnsTransaction', () => {
  const { state } = mount(everyType());
  const blocks = topLevel(state);
  const splittable = blocks.filter((b) => b.type !== 'divider');

  it('wraps every block type against every other, above and below, losing and duplicating nothing', () => {
    let wrapped = 0;
    for (const source of splittable) {
      for (const target of blocks) {
        if (target.sid === source.sid) continue;
        for (const side of ['left', 'right'] as const) {
          const tr = split(state, source, target, side);
          const label = `${source.type} -> ${target.type} ${side}`;
          if (target.type === 'divider' || target.type === 'table') {
            expect(tr, label).toBeNull();
            continue;
          }
          expect(tr, label).not.toBeNull();
          const next = state.apply(tr!);
          next.doc.check();
          expect(leaves(next), label).toEqual(leaves(state));
          expect(next.doc.childCount, label).toBe(state.doc.childCount - 1);

          const layoutNode = next.doc.child(topLevel(next).findIndex((b) => b.type === 'twoColumn'));
          const lanes = [layoutNode.child(1), layoutNode.child(2)];
          const [left, right] = side === 'left' ? [source, target] : [target, source];
          expect(lanes.map((lane) => String(lane.child(1).attrs.sid)), label).toEqual([left.sid, right.sid]);
          expect(lanes.map((lane) => lane.childCount), label).toEqual([2, 2]);
          expect(layoutNode.attrs.splitRatio).toBe(0.5);
          wrapped += 1;
        }
      }
    }
    // Twelve sources are also targets and the table is only a source, so 12 * 11 + 12 pairs, two sides each.
    expect(wrapped).toBe((12 * 11 + 12) * 2);
  }, 60_000);

  it('puts the layout where the target was', () => {
    const next = state.apply(split(state, blocks[0], blocks[2], 'right')!);
    expect(topLevel(next).slice(0, 2).map((x) => x.type)).toEqual(['heading', 'twoColumn']);
    expect(String(next.doc.child(0).attrs.sid)).toBe(blocks[1].sid);
  });

  it('mints a distinct sid for the layout and each lane', () => {
    const next = state.apply(split(state, blocks[0], blocks[1], 'left')!);
    const sids: string[] = [];
    next.doc.descendants((node) => {
      if (node.attrs.sid !== undefined && node.type.name !== 'line') sids.push(String(node.attrs.sid));
    });
    expect(sids.every((sid) => sid !== '')).toBe(true);
    expect(new Set(sids).size).toBe(sids.length);
  });

  it('refuses a divider, a layout as source, a block against itself and a table as target', () => {
    const divider = blocks.find((b) => b.type === 'divider')!;
    expect(split(state, divider, blocks[0], 'left')).toBeNull();
    expect(split(state, blocks[0], divider, 'left')).toBeNull();
    expect(split(state, blocks[0], blocks[0], 'left')).toBeNull();
    const withLayout = mount([
      block('Text', [span('x')]),
      layout([block('Text', [span('a')])], [block('Text', [span('b')])]),
    ]).state;
    const [x, layoutBlock] = topLevel(withLayout);
    expect(split(withLayout, layoutBlock, x, 'left')).toBeNull();
    expect(split(withLayout, x, layoutBlock, 'left')).toBeNull();
  });

  it('refuses a table row or cell as the source', () => {
    for (const name of ['tableRow', 'tableCell']) {
      let part: Located | null = null;
      state.doc.descendants((node, pos) => {
        if (!part && node.type.name === name) part = { pos, sid: String(node.attrs.sid), type: name };
      });
      expect(part, name).not.toBeNull();
      expect(split(state, part!, blocks[0], 'left'), name).toBeNull();
    }
  });

  it('puts the caret in the first cell of a dragged table', () => {
    const table = blocks.find((b) => b.type === 'table')!;
    const next = state.apply(split(state, table, blocks[0], 'left')!);
    expect(next.selection.$from.node(next.selection.$from.depth - 1).type.name).toBe('tableCell');
    expect(next.selection.$from.parent.textContent).toBe('h1');
  });

  it('refuses a source or target that already holds a layout', () => {
    const nested = mount([
      block('Text', [span('x')]),
      block('BulletList', [span('parent')], { kind: 'empty' }, {
        children: [layout([block('Text', [span('a')])], [block('Text', [span('b')])])],
      }),
    ]).state;
    const [x, parent] = topLevel(nested);
    expect(split(nested, parent, x, 'left')).toBeNull();
    expect(split(nested, x, parent, 'left')).toBeNull();
  });

  it('refuses a stale source or target', () => {
    const [a, b] = blocks;
    expect(splitBlockIntoColumnsTransaction(state, a.pos, 'nope', b.pos, b.sid, 'left')).toBeNull();
    expect(splitBlockIntoColumnsTransaction(state, a.pos, a.sid, b.pos, 'nope', 'left')).toBeNull();
  });

  it('is one undo step and redoes as one', () => {
    const next = state.apply(split(state, blocks[0], blocks[3], 'left')!);
    const undone = applyHistory(next, undo);
    expect(undone.doc.eq(state.doc)).toBe(true);
    expect(applyHistory(undone, redo).doc.eq(next.doc)).toBe(true);
  });

  it('puts the caret in the dragged block', () => {
    const next = state.apply(split(state, blocks[0], blocks[1], 'right')!);
    expect(next.selection.$from.parent.textContent).toBe('text');
  });
});

describe('splitBlockIntoColumnsTransaction from a nested source', () => {
  const nested = () =>
    mount([
      block('Text', [span('top')]),
      block('BulletList', [span('parent')], { kind: 'empty' }, { children: [block('BulletList', [span('child')])] }),
      layout([block('Text', [span('a')]), block('Text', [span('b')])], [block('Text', [span('c')])]),
      block('Text', [span('tail')]),
    ]).state;

  it('lifts a list child out into the split', () => {
    const state = nested();
    const next = state.apply(split(state, find(state, 'child'), find(state, 'tail'), 'left')!);
    next.doc.check();
    expect(leaves(next)).toEqual(leaves(state));
    expect(next.doc.childCount).toBe(state.doc.childCount);
  });

  it('lifts a block out of a column and reseeds a cell it empties, in one undo step', () => {
    const state = nested();
    const next = state.apply(split(state, find(state, 'c'), find(state, 'top'), 'right')!);
    next.doc.check();
    const before = leaves(state);
    const after = leaves(next);
    // The emptied lane gets one blank paragraph, and nothing else changes.
    expect(after.filter((x) => !before.includes(x))).toHaveLength(1);
    expect(before.filter((x) => !after.includes(x))).toEqual([]);
    expect(applyHistory(next, undo).doc.eq(state.doc)).toBe(true);
  });

  it('keeps the remaining blocks of a column that still has company', () => {
    const state = nested();
    const next = state.apply(split(state, find(state, 'a'), find(state, 'tail'), 'left')!);
    expect(leaves(next)).toEqual(leaves(state));
  });

  it('refuses a block inside the target and a target inside a layout', () => {
    const state = nested();
    expect(split(state, find(state, 'child'), find(state, 'parent'), 'left')).toBeNull();
    expect(split(state, find(state, 'top'), find(state, 'a'), 'left')).toBeNull();
  });
});

describe('a split layout in a saved note', () => {
  it('round trips through the wire format with both sids and an even ratio', () => {
    const { state, fromDoc } = mount([block('Text', [span('one')]), block('Text', [span('two')])]);
    const [one, two] = topLevel(state);
    const next = state.apply(split(state, two, one, 'left')!);

    const saved = fromDoc(next.doc);
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('TwoColumn');
    expect(saved[0].payload).toEqual({ kind: 'twoColumn', splitRatio: 0.5 });
    expect(saved[0].children?.map((cell) => cell.children?.map((b) => b.sid))).toEqual([[two.sid], [one.sid]]);

    const reread = saved.map((b) => parseBlock(JSON.parse(JSON.stringify(serializeBlock(b)))));
    const reloaded = mount(reread);
    expect(leaves(reloaded.state)).toEqual(leaves(next));
    expect(reloaded.fromDoc(reloaded.state.doc)).toEqual(saved);
  });

  it('writes markdown with the left lane first', () => {
    const { state } = mount([block('Text', [span('one')]), block('Text', [span('two')])]);
    const [one, two] = topLevel(state);
    const left = state.apply(split(state, two, one, 'left')!);
    const right = state.apply(split(state, two, one, 'right')!);
    expect(markdown.document(left.doc)).toBe('two\n\none');
    expect(markdown.document(right.doc)).toBe('one\n\ntwo');
  });
});
