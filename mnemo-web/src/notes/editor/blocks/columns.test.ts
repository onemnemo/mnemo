// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { blockChildrenOf } from './shared';
import { displaySplitRatio } from './columns';

const { schema, registry } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
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

function stateWith(document: PMNode): EditorState {
  return EditorState.create({ schema, doc: document, plugins: [invariantPipeline(registry)] });
}

/** The two column-group nodes of the first (and only) two-column block. */
function columnsOf(document: PMNode): PMNode[] {
  const tc = document.firstChild!;
  const cols: PMNode[] = [];
  tc.forEach((child) => {
    if (child.type.name === 'columnGroup') cols.push(child);
  });
  return cols;
}

/** Absolute position range of the first block child inside the left column. */
function leftBlockRange(document: PMNode): { from: number; to: number } {
  let range: { from: number; to: number } | null = null;
  document.descendants((node, pos) => {
    if (range) return false;
    if (node.type.name === 'columnGroup') {
      const first = blockChildrenOf(node)[0];
      if (first) {
        // columnGroup opens at pos, its line at pos+1, the first block after it.
        const blockPos = pos + 1 + node.firstChild!.nodeSize;
        range = { from: blockPos, to: blockPos + first.nodeSize };
      }
      return false;
    }
    return true;
  });
  return range!;
}

// --- the invariant ----------------------------------------------------------

describe('column-never-empty invariant', () => {
  it('re-seeds an empty Text block when a cell loses its last block child', () => {
    const state = stateWith(twoColumnDoc());
    const { from, to } = leftBlockRange(state.doc);
    // Delete the left cell's only block; the invariant must refill the cell.
    const next = state.apply(state.tr.delete(from, to));

    const [left, right] = columnsOf(next.doc);
    const leftChildren = blockChildrenOf(left);
    expect(leftChildren).toHaveLength(1);
    expect(leftChildren[0].type.name).toBe('paragraph');
    expect(leftChildren[0].textContent).toBe('');
    // The untouched right cell is left exactly as it was.
    expect(blockChildrenOf(right)).toHaveLength(1);
    expect(blockChildrenOf(right)[0].textContent).toBe('b');
  });

  it('does not touch a cell that still has a block after the edit', () => {
    const state = stateWith(twoColumnDoc());
    const { from } = leftBlockRange(state.doc);
    // Type into the left cell's block rather than emptying it.
    const next = state.apply(state.tr.insertText('x', from + 2));
    const [left] = columnsOf(next.doc);
    expect(blockChildrenOf(left)).toHaveLength(1);
    expect(blockChildrenOf(left)[0].textContent).toBe('xa');
  });

  it('leaves a non-column edit alone', () => {
    const before = doc(para('a'), para('b'));
    const state = stateWith(before);
    const next = state.apply(state.tr.insertText('z', 2));
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.firstChild!.textContent).toBe('za');
  });

  it('registers exactly one column invariant, ordered before heading-bold', () => {
    const ids = registry.invariants.map((i) => i.id);
    expect(ids).toContain('column.neverEmpty');
    expect(ids.indexOf('column.neverEmpty')).toBeLessThan(ids.indexOf('heading.forceBold'));
  });
});

function twoColumnDoc(): PMNode {
  return doc(twoColumn(column(para('a')), column(para('b'))));
}

// --- split ratio for display ------------------------------------------------

describe('split ratio for display', () => {
  it('keeps a resized ratio as the left lane share', () => {
    expect(displaySplitRatio(0.5725)).toBe(0.5725);
    expect(displaySplitRatio(0.517)).toBe(0.517);
  });

  it('centres a value that would collapse a lane', () => {
    expect(displaySplitRatio(0)).toBe(0.5);
    expect(displaySplitRatio(1)).toBe(0.5);
    expect(displaySplitRatio(Number.NaN)).toBe(0.5);
    expect(displaySplitRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
  });

  it('holds a lopsided ratio to a visible minimum on each side', () => {
    expect(displaySplitRatio(0.02)).toBe(0.1);
    expect(displaySplitRatio(0.98)).toBe(0.9);
  });
});

describe('two-column rendering', () => {
  function renderAttrs(ratio: number): Record<string, string> {
    const node = schema.nodes.twoColumn.create({ splitRatio: ratio }, [
      line(),
      column(para('a')),
      column(para('b')),
    ]);
    const out = schema.nodes.twoColumn.spec.toDOM!(node) as [string, Record<string, string>, number];
    return out[1];
  }

  it('drives the left lane width from the display ratio', () => {
    expect(renderAttrs(0.5725).style).toBe('--notes-split:0.5725');
  });

  it('normalizes the rendered ratio without touching the stored value', () => {
    const attrs = renderAttrs(0);
    // Layout centres an unusable ratio,
    expect(attrs.style).toBe('--notes-split:0.5');
    // while the raw attribute is preserved for round-trip.
    expect(attrs['data-split']).toBe('0');
  });
});
