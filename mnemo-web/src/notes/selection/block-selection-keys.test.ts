// @vitest-environment jsdom

/**
 * What the keys do to a live block selection. Driven through a mounted view
 * because the handler answers by dispatching into one, and offered to the
 * plugin the way prosemirror-view offers a key.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { blockSelectionKey, blockSelectionPlugin, getBlockSelection } from './block-selection-plugin';

const { schema, registry } = createEditorSchema();

const line = (text?: string): PMNode => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string): PMNode =>
  schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const cell = (text: string, sid: string): PMNode =>
  schema.nodes.tableCell.create({ sid, id: sid }, line(text));
const tableOf = (...cells: PMNode[]): PMNode =>
  schema.nodes.table.create({ columnWidths: [] }, [
    line(),
    schema.nodes.tableRow.create(null, [line(), ...cells]),
  ]);

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(blocks: PMNode[], selected: readonly string[]): EditorView {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, {
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, blocks),
      plugins: [blockSelectionPlugin(registry)],
    }),
  });
  views.push(view);
  view.dispatch(
    view.state.tr.setMeta(blockSelectionKey, {
      type: 'set',
      selection: { selected: new Set(selected), anchorSid: selected[0] ?? null },
    }),
  );
  return view;
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

/** A paragraph beside a table, with only one of the table's cells selected. */
function uncoverableSelection(): EditorView {
  return mount([para('before', 'p1'), tableOf(cell('a', 'c1'), cell('b', 'c2'))], ['c2']);
}

describe('Backspace and Delete on a block selection', () => {
  it('remove the selected block and end the selection with it', () => {
    for (const key of ['Backspace', 'Delete']) {
      const view = mount([para('one', 'p1'), para('two', 'p2')], ['p1']);
      expect(press(view, key)).toBe(true);
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.child(0).textContent).toBe('two');
      expect(getBlockSelection(view.state).selected.size).toBe(0);
    }
  });

  /**
   * A run that merely spans past a table can cover one of its cells, and a lone
   * covered cell is a shape only the table's own commands change. The press has
   * to leave the user somewhere, rather than claiming the key over a highlight
   * standing on an unchanged document.
   */
  it('end a selection they cannot delete rather than going dead', () => {
    for (const key of ['Backspace', 'Delete']) {
      const view = uncoverableSelection();
      const before = view.state.doc;
      expect(press(view, key)).toBe(true);
      expect(view.state.doc).toBe(before);
      expect(getBlockSelection(view.state).selected.size).toBe(0);
    }
  });

  it('are back to being ordinary keys once that selection is gone', () => {
    const view = uncoverableSelection();
    press(view, 'Backspace');
    expect(press(view, 'Backspace')).toBe(false);
  });
});

describe('Escape on a block selection', () => {
  it('drops the selection without touching the document', () => {
    const view = mount([para('one', 'p1'), para('two', 'p2')], ['p1']);
    const before = view.state.doc;
    expect(press(view, 'Escape')).toBe(true);
    expect(view.state.doc).toBe(before);
    expect(getBlockSelection(view.state).selected.size).toBe(0);
  });
});
