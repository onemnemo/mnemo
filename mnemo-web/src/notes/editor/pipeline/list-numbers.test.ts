// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { listNumberDecorations, numberedListPlugin } from './list-numbers';

const { schema } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function num(text?: string): PMNode {
  return schema.nodes.numberedItem.create(null, line(text));
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function bullet(text?: string): PMNode {
  return schema.nodes.bulletItem.create(null, line(text));
}
function column(...blocks: PMNode[]): PMNode {
  return schema.nodes.columnGroup.create(null, [line(), ...blocks]);
}
function twoColumn(left: PMNode, right: PMNode): PMNode {
  return schema.nodes.twoColumn.create(null, [line(), left, right]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

/** The numbers the decoration assigns, in document order. */
function numbers(document: PMNode): string[] {
  return listNumberDecorations(document).map(
    (d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs['data-list-number'],
  );
}

// --- runs and resets --------------------------------------------------------

describe('numbered-list numbering', () => {
  it('counts a consecutive run 1, 2, 3', () => {
    expect(numbers(doc(num('a'), num('b'), num('c')))).toEqual(['1', '2', '3']);
  });

  it('restarts the run after a non-numbered block', () => {
    expect(numbers(doc(num('a'), num('b'), para('x'), num('c')))).toEqual(['1', '2', '1']);
  });

  it('resets even for a bullet between numbered items', () => {
    expect(numbers(doc(num('a'), bullet('b'), num('c')))).toEqual(['1', '1']);
  });

  it('starts every run at 1 — the leading number is not stored', () => {
    // Two separate runs; neither remembers a prior index.
    expect(numbers(doc(num(), para(), num(), num()))).toEqual(['1', '1', '2']);
  });

  it('produces nothing when there are no numbered items', () => {
    expect(numbers(doc(para('a'), bullet('b')))).toEqual([]);
  });

  it('emits decorations in increasing document position', () => {
    const decos = listNumberDecorations(doc(num('a'), para('x'), num('b')));
    expect(decos).toHaveLength(2);
    expect(decos[0].from).toBeLessThan(decos[1].from);
  });
});

// --- two-column flattening --------------------------------------------------

describe('numbered-list numbering across two columns', () => {
  it('flattens left column then right with no reset at the boundary', () => {
    const d = doc(twoColumn(column(num('l1'), num('l2')), column(num('r1'), num('r2'))));
    expect(numbers(d)).toEqual(['1', '2', '3', '4']);
  });

  it('lets a run flow from a top-level item into a two-column and back out', () => {
    const d = doc(
      num('top'),
      twoColumn(column(num('l')), column(num('r'))),
      num('after'),
    );
    // The container never resets, so the sequence is continuous through it.
    expect(numbers(d)).toEqual(['1', '2', '3', '4']);
  });

  it('resets inside a column but stays continuous across the column boundary', () => {
    const d = doc(twoColumn(column(num('l1'), para('gap'), num('l2')), column(num('r1'))));
    // left: 1, (paragraph resets), 1; right continues that second run: 2.
    expect(numbers(d)).toEqual(['1', '1', '2']);
  });

  it('treats a nested two-column as a single non-numbered block (resets, no descent)', () => {
    const nested = twoColumn(column(num('deep')), column(num('deeper')));
    const d = doc(num('a'), twoColumn(column(nested), column(num('r'))));
    // top 'a' -> 1; the nested container resets and is not descended into; the
    // right cell then starts a fresh run at 1.
    expect(numbers(d)).toEqual(['1', '1']);
  });
});

// --- plugin -----------------------------------------------------------------

describe('numberedListPlugin', () => {
  it('exposes a decoration set and recomputes it on document change', () => {
    const plugin = numberedListPlugin();
    let state = EditorState.create({ schema, doc: doc(num('a'), num('b')), plugins: [plugin] });
    const initial = plugin.getState(state) as DecorationSet;
    expect(initial.find()).toHaveLength(2);

    // Insert a paragraph between the two items; the second item must renumber to 1.
    const between = doc(num('a')).firstChild!.nodeSize; // end of the first item
    state = state.apply(state.tr.insert(between, para('x')));
    const after = numbers(state.doc);
    expect(after).toEqual(['1', '1']);
  });
});
