// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { listLabel, listNumberDecorations, numberedListPlugin } from './list-numbers';

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

  it('starts a run at 1 when its first item stores no start', () => {
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

  it('stays transparent through a nested two-column as well', () => {
    const nested = twoColumn(column(num('deep')), column(num('deeper')));
    const d = doc(num('a'), twoColumn(column(nested), column(num('r'))));
    // A container is transparent at any depth: top 'a' -> 1, the inner cells
    // continue with 2 and 3, and the outer right cell carries on with 4.
    expect(numbers(d)).toEqual(['1', '2', '3', '4']);
  });
});

// --- plugin -----------------------------------------------------------------

describe('numberedListPlugin', () => {
  it('exposes a decoration set and recomputes it on document change', () => {
    const plugin = numberedListPlugin();
    let state = EditorState.create({ schema, doc: doc(num('a'), num('b')), plugins: [plugin] });
    expect(plugin.getState(state)!.decorations.find()).toHaveLength(2);

    // Insert a paragraph between the two items; the second item must renumber to 1.
    const between = doc(num('a')).firstChild!.nodeSize; // end of the first item
    state = state.apply(state.tr.insert(between, para('x')));
    const after = numbers(state.doc);
    expect(after).toEqual(['1', '1']);
  });

  it('maps the set through typing instead of rebuilding it', () => {
    const plugin = numberedListPlugin();
    const state = EditorState.create({ schema, doc: doc(num('a'), num('b')), plugins: [plugin] });
    const typed = state.apply(state.tr.insertText('z', 2));
    const set = plugin.getState(typed)!.decorations;
    expect(set.find().map((d) => [d.from, d.to])).toEqual([
      [0, typed.doc.child(0).nodeSize],
      [typed.doc.child(0).nodeSize, typed.doc.content.size],
    ]);
    expect(plugin.getState(typed)!.decorations).not.toBe(plugin.getState(state)!.decorations);
  });
});

// --- nesting ----------------------------------------------------------------

function numWith(text: string, ...children: PMNode[]): PMNode {
  return schema.nodes.numberedItem.create(null, [line(text), ...children]);
}
function bulletWith(text: string, ...children: PMNode[]): PMNode {
  return schema.nodes.bulletItem.create(null, [line(text), ...children]);
}

describe('numbered-list numbering in nested lists', () => {
  it('gives a sub-list its own run and lets the parent run carry on past it', () => {
    const d = doc(numWith('one', num('x'), num('y')), num('two'));
    expect(numbers(d)).toEqual(['1', 'a', 'b', '2']);
  });

  it('labels by depth: decimal, letters, roman, then decimal again', () => {
    const d = doc(numWith('1', numWith('a', numWith('i', num('deep')))));
    expect(numbers(d)).toEqual(['1', 'a', 'i', '1']);
  });

  it('resets only the inner run when a bullet sits between nested items', () => {
    const d = doc(numWith('one', num('x'), bullet('gap'), num('y')), num('two'));
    expect(numbers(d)).toEqual(['1', 'a', 'a', '2']);
  });

  it('counts depth by list-item ancestors, so a list under a bullet is one level down', () => {
    const d = doc(bulletWith('b', num('x'), num('y')));
    expect(numbers(d)).toEqual(['a', 'b']);
  });

  it('numbers the children of a de-formatted parent at its own depth', () => {
    const p = schema.nodes.paragraph.create(null, [line('was a list'), num('x'), num('y')]);
    expect(numbers(doc(p))).toEqual(['1', '2']);
  });

  it('keeps a two-column transparent inside a sub-list', () => {
    const d = doc(numWith('one', num('x'), twoColumn(column(num('l')), column(num('r'))), num('y')));
    expect(numbers(d)).toEqual(['1', 'a', 'b', 'c', 'd']);
  });
});

// --- stored starts ------------------------------------------------------------

function numFrom(start: unknown, text?: string, key = 'listStart'): PMNode {
  return schema.nodes.numberedItem.create({ meta: { [key]: start } }, line(text));
}

describe('numbered-list numbering from a stored start', () => {
  it('counts a run up from the start its first item stores', () => {
    expect(numbers(doc(numFrom(8, 'a'), num('b'), num('c')))).toEqual(['8', '9', '10']);
  });

  it('never reads what a later item stores', () => {
    expect(numbers(doc(numFrom(8), numFrom(3), numFrom(99)))).toEqual(['8', '9', '10']);
  });

  it('gives every run its own start', () => {
    expect(numbers(doc(numFrom(5), num(), para(), num(), para(), numFrom(2)))).toEqual(['5', '6', '1', '2']);
  });

  it('never reads the per-item numbers older imports stored', () => {
    expect(numbers(doc(numFrom(7, 'a', 'listNumberIndex'), num('b')))).toEqual(['1', '2']);
    expect(numbers(doc(numFrom('7.', 'a', 'listNumber'), num('b')))).toEqual(['1', '2']);
  });

  it('keeps a start of 0 at decimal depth and counts from 1 under a letter label', () => {
    expect(numbers(doc(numFrom(0), num()))).toEqual(['0', '1']);
    const nested = schema.nodes.numberedItem.create(null, [line('one'), numFrom(0, 'x'), num('y')]);
    expect(numbers(doc(nested))).toEqual(['1', 'a', 'b']);
  });

  it('starts at 1 for a stored number no list can start at', () => {
    expect(numbers(doc(numFrom(-4)))).toEqual(['1']);
    expect(numbers(doc(numFrom(2.5)))).toEqual(['1']);
    expect(numbers(doc(numFrom('soon')))).toEqual(['1']);
  });

  it('gives a nested run its own start, labelled at its depth', () => {
    const nested = schema.nodes.numberedItem.create(null, [line('one'), numFrom(3, 'x'), num('y')]);
    expect(numbers(doc(nested, num('two')))).toEqual(['1', 'c', 'd', '2']);
  });

  it('carries a start through a two-column the run flows into', () => {
    const d = doc(numFrom(4, 'top'), twoColumn(column(num('l')), column(num('r'))));
    expect(numbers(d)).toEqual(['4', '5', '6']);
  });
});

describe('listLabel', () => {
  it('spells the three styles and cycles past them', () => {
    expect(listLabel(1, 0)).toBe('1');
    expect(listLabel(12, 0)).toBe('12');
    expect(listLabel(1, 1)).toBe('a');
    expect(listLabel(26, 1)).toBe('z');
    expect(listLabel(27, 1)).toBe('aa');
    expect(listLabel(28, 1)).toBe('ab');
    expect(listLabel(1, 2)).toBe('i');
    expect(listLabel(4, 2)).toBe('iv');
    expect(listLabel(9, 2)).toBe('ix');
    expect(listLabel(14, 2)).toBe('xiv');
    expect(listLabel(1994, 2)).toBe('mcmxciv');
    expect(listLabel(3, 3)).toBe('3');
    expect(listLabel(2, 4)).toBe('b');
  });

  it('falls back to decimal where roman numerals stop being legible', () => {
    expect(listLabel(4000, 2)).toBe('4000');
  });
});
