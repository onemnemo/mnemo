// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';

import { createEditorSchema } from '../schema';
import { convertHere, insertAtomicBlock, insertPageBlock, insertTwoColumn } from './slash-insert';
import type { EditorServices, SlashInsertContext } from '../registry/types';

const { schema } = createEditorSchema();

function services(createChild: () => Promise<string>): EditorServices {
  return {
    resolveNoteTitle: () => undefined,
    notes: { isLoaded: () => true, subscribe: () => () => {}, createChild },
    loadAssetUrl: () => Promise.reject(new Error('none')),
    uploadAsset: () => Promise.reject(new Error('none')),
  };
}

/** One paragraph holding the typed query, the state a slash row is picked in. */
function picked(query = '/page') {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text(query))),
  ]);
  // The default selection is the first text position, which is inside the line
  // the query was typed on, exactly where a pick happens.
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const dispatch = (tr: Transaction) => {
    dispatched.push(tr);
    state = state.apply(tr);
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    dispatched,
  };
}

describe('the page slash row', () => {
  it('creates the note before it writes the card that points at it', async () => {
    const picker = picked();
    const order: string[] = [];
    const context: SlashInsertContext = {
      services: services(async () => {
        order.push('create');
        return 'created-note';
      }),
      currentState: () => picker.state,
    };

    await insertPageBlock(picker.state, (tr) => {
      order.push('dispatch');
      picker.dispatch(tr);
    }, context);

    expect(order).toEqual(['create', 'dispatch']);
    const page = picker.state.doc.firstChild!;
    expect(page.type.name).toBe('page');
    expect(page.attrs.referenceNoteId).toBe('created-note');
    // The typed query was a command, not content, and the caret needs somewhere
    // to go after a block it cannot sit in.
    expect(page.textContent).toBe('');
    expect(picker.state.doc.childCount).toBe(2);
  });

  it('writes nothing when the note cannot be created', async () => {
    const picker = picked();
    const context: SlashInsertContext = {
      services: services(() => Promise.reject(new Error('offline'))),
      currentState: () => picker.state,
    };

    await insertPageBlock(picker.state, picker.dispatch, context);

    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.firstChild!.type.name).toBe('paragraph');
  });

  it('does nothing at all where no note library is mounted', async () => {
    const picker = picked();
    const bare: SlashInsertContext = {
      services: { ...services(() => Promise.resolve('x')), notes: undefined },
      currentState: () => picker.state,
    };

    await insertPageBlock(picker.state, picker.dispatch, bare);
    await insertPageBlock(picker.state, picker.dispatch, undefined);

    expect(picker.dispatched).toHaveLength(0);
  });

  it('builds its step from the document as it is after the request, not before', async () => {
    const picker = picked();
    const stale = picker.state;
    const currentState = vi.fn(() => picker.state);

    // Something else lands while the create is in flight: another block above the
    // one the row was picked in, which moves every position below it.
    const context: SlashInsertContext = {
      services: services(async () => {
        picker.dispatch(
          picker.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.nodes.line.create())),
        );
        return 'created-note';
      }),
      currentState,
    };

    await insertPageBlock(stale, picker.dispatch, context);

    expect(currentState).toHaveBeenCalled();
    // The card replaced the block the row was picked in, which is now second.
    expect(picker.state.doc.child(0).type.name).toBe('paragraph');
    expect(picker.state.doc.child(1).type.name).toBe('page');
  });
});

// --- the table-cell guard shared by every conversion row --------------------

/**
 * A one-cell table with the caret at the start of that cell's own line, the
 * shape `blockContext` resolves straight to the `tableCell` node itself
 * (its content is `"line block*"` like any other block, so there is nothing
 * about the caret's position that marks it as being inside a table rather
 * than inside an ordinary block).
 */
function pickedInCell(query = '/quote') {
  const cell = schema.nodes.tableCell.create(
    null,
    schema.nodes.line.create(null, schema.text(query)),
  );
  const row = schema.nodes.tableRow.create(null, [schema.nodes.line.create(), cell]);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.table.create({ columnWidths: [] }, [schema.nodes.line.create(), row]),
  ]);
  let cellPos = -1;
  doc.descendants((node, pos) => {
    if (cellPos >= 0) return false;
    if (node.type.name === 'tableCell') cellPos = pos;
    return true;
  });
  let state = EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, cellPos + 2),
  });
  const dispatched: Transaction[] = [];
  const dispatch = (tr: Transaction) => {
    dispatched.push(tr);
    state = state.apply(tr);
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    dispatched,
  };
}

describe('the table-cell guard shared by every conversion row', () => {
  it('convertHere leaves the cell untouched: the row cannot hold anything else in its place', () => {
    const picker = pickedInCell('/quote');
    convertHere('quote')(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.firstChild!.type.name).toBe('table');
  });

  it('insertAtomicBlock leaves the cell untouched', () => {
    const picker = pickedInCell('/divider');
    insertAtomicBlock('divider')(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.firstChild!.type.name).toBe('table');
  });

  it('insertPageBlock never creates a note when the caret is in a table cell', async () => {
    const picker = pickedInCell('/page');
    const create = vi.fn(async () => 'created-note');
    const context: SlashInsertContext = {
      services: services(create),
      currentState: () => picker.state,
    };

    await insertPageBlock(picker.state, picker.dispatch, context);

    // The whole point of the guard: refusing only inside `insertAtomicBlock`
    // would still leave this call made and a real note behind.
    expect(create).not.toHaveBeenCalled();
    expect(picker.dispatched).toHaveLength(0);
  });

  it('insertTwoColumn leaves the cell untouched', () => {
    const picker = pickedInCell('/columns');
    insertTwoColumn(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.firstChild!.type.name).toBe('table');
  });
});
