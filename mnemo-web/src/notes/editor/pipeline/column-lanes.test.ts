// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { DecorationSet } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { columnLanesPlugin, layoutAround } from './column-lanes';

const { schema } = createEditorSchema();
const n = schema.nodes;

const line = (text?: string) => n.line.create(null, text ? schema.text(text) : null);
const paragraph = (text?: string) => n.paragraph.create(null, line(text));
const cell = (...blocks: PMNode[]) => n.columnGroup.create(null, [line(), ...blocks]);
const split = (left: PMNode, right: PMNode) => n.twoColumn.create(null, [line(), left, right]);
const docOf = (...blocks: PMNode[]) => n.doc.create(null, blocks);

const bothEmpty = () => split(cell(paragraph()), cell(paragraph()));

const plugin = columnLanesPlugin();
const create = (doc: PMNode, selection?: TextSelection) =>
  EditorState.create({ schema, doc, plugins: [plugin], selection });

function decorationsOf(state: EditorState): DecorationSet | null {
  return plugin.props.decorations!.call(plugin, state) as DecorationSet | null;
}

/** The decorated lanes, as the type name of the node each decoration covers. */
function marked(state: EditorState): string[] {
  const set = decorationsOf(state);
  return set ? set.find().map((d) => state.doc.nodeAt(d.from)!.type.name) : [];
}

/** The first position inside the first empty paragraph line found after `from`. */
function caretInEmptyLine(doc: PMNode, from = 0): number {
  let at = -1;
  doc.nodesBetween(from, doc.content.size, (node, pos) => {
    if (at !== -1) return false;
    if (node.type.name === 'paragraph' && node.firstChild?.content.size === 0) at = pos + 2;
    return true;
  });
  return at;
}

describe('layoutAround', () => {
  it('finds the layout holding a position and null elsewhere', () => {
    const doc = docOf(paragraph('x'), bothEmpty());
    expect(layoutAround(doc, caretInEmptyLine(doc))).toBe(doc.child(0).nodeSize);
    expect(layoutAround(doc, 2)).toBeNull();
  });
});

describe('columnLanesPlugin', () => {
  it('marks both lanes of the layout holding the caret, the one without it included', () => {
    const doc = docOf(paragraph('x'), bothEmpty());
    const state = create(doc, TextSelection.create(doc, caretInEmptyLine(doc)));
    expect(marked(state)).toEqual(['columnGroup', 'columnGroup']);
  });

  it('marks nothing while the caret is outside every layout', () => {
    const doc = docOf(paragraph('x'), bothEmpty());
    expect(decorationsOf(create(doc, TextSelection.create(doc, 2)))).toBeNull();
  });

  it('marks only the lanes of the innermost layout holding the caret', () => {
    const doc = docOf(split(cell(paragraph('x'), bothEmpty()), cell(paragraph())));
    const inner = caretInEmptyLine(doc);
    const state = create(doc, TextSelection.create(doc, inner));
    const set = decorationsOf(state)!;
    const outer = doc.child(0);
    expect(set.find()).toHaveLength(2);
    for (const decoration of set.find()) expect(decoration.from).toBeGreaterThan(outer.child(1).firstChild!.nodeSize);
  });

  it('marks lanes that hold text the same way', () => {
    const doc = docOf(split(cell(paragraph('a')), cell(paragraph('b'))));
    expect(marked(create(doc, TextSelection.create(doc, 5)))).toEqual(['columnGroup', 'columnGroup']);
  });
});
