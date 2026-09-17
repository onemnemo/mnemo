// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';

import { createEditorSchema } from '../schema';
import {
  convertHere,
  insertAtomicBlock,
  insertPageBlock,
  insertTable,
  insertTwoColumn,
} from './slash-insert';
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

/**
 * One paragraph holding `text`, the state a slash row is picked in. The menu
 * has already taken the typed query out by then, so an empty line is the
 * common case and a line with text is a query typed after a sentence.
 */
function picked(text = '', caret = 2 + text.length) {
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(
      null,
      schema.nodes.line.create(null, text.length > 0 ? schema.text(text) : null),
    ),
  ]);
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) });
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
    // The caret needs somewhere to go after a block it cannot sit in.
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

/**
 * What a row finds in the line is content, never the query, so a line that
 * holds anything is the user's sentence and has to survive the pick.
 */
describe('a row picked on a line that holds content', () => {
  it('convertHere changes the type around the content and keeps the caret', () => {
    const picker = picked('some text', 6);
    convertHere('heading', { level: 2 })(picker.state, picker.dispatch);
    const block = picker.state.doc.firstChild!;
    expect(block.type.name).toBe('heading');
    expect(block.attrs.level).toBe(2);
    expect(block.textContent).toBe('some text');
    expect(picker.state.selection.from).toBe(6);
  });

  it('convertHere into a code block keeps the characters and strips the marks', () => {
    const strong = schema.marks.strong.create();
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(
        null,
        schema.nodes.line.create(null, schema.text('bold', [strong])),
      ),
    ]);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 6) });
    convertHere('codeBlock')(state, (tr) => {
      state = state.apply(tr);
    });
    const block = state.doc.firstChild!;
    expect(block.type.name).toBe('codeBlock');
    expect(block.textContent).toBe('bold');
    expect(state.selection.from).toBe(6);
  });

  it('insertAtomicBlock keeps the block and puts the new one after it', () => {
    const picker = picked('some text');
    insertAtomicBlock('divider')(picker.state, picker.dispatch);
    const doc = picker.state.doc;
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('some text');
    expect(doc.child(1).type.name).toBe('divider');
    // The new block carries no identity of its own; it is minted one on commit.
    expect(doc.child(1).attrs.sid).toBe(schema.nodes.divider.create().attrs.sid);
    expect(doc.child(2).type.name).toBe('paragraph');
    expect(picker.state.selection.from).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize + 2);
  });

  it('insertAtomicBlock still converts an empty block in place, identity and all', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create({ sid: 'abc12', order: 3 }, schema.nodes.line.create()),
    ]);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2) });
    insertAtomicBlock('divider')(state, (tr) => {
      state = state.apply(tr);
    });
    expect(state.doc.child(0).type.name).toBe('divider');
    expect(state.doc.child(0).attrs.sid).toBe('abc12');
    expect(state.doc.child(0).attrs.order).toBe(3);
  });

  it('insertTwoColumn puts the split after the block and lands in its left cell', () => {
    const picker = picked('some text');
    insertTwoColumn(picker.state, picker.dispatch);
    const doc = picker.state.doc;
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('some text');
    expect(doc.child(1).type.name).toBe('twoColumn');
    expect((doc.child(1).attrs.meta as Record<string, unknown>).nativeTwoColumn).toBe(true);
    const { $from } = picker.state.selection;
    expect($from.node($from.depth - 1).type.name).toBe('paragraph');
    expect($from.node($from.depth - 2).type.name).toBe('columnGroup');
    expect($from.node($from.depth - 3).type.name).toBe('twoColumn');
  });

  it('insertTable puts the table after the block and lands in its first cell', () => {
    const picker = picked('some text');
    insertTable(picker.state, picker.dispatch);
    const doc = picker.state.doc;
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('some text');
    expect(doc.child(1).type.name).toBe('table');
    const { $from } = picker.state.selection;
    expect($from.node($from.depth - 1).type.name).toBe('tableCell');
  });
});

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

  it('insertTable leaves the cell untouched', () => {
    const picker = pickedInCell('/table');
    insertTable(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.firstChild!.type.name).toBe('table');
  });
});

/**
 * A two-column whose left cell holds one block, with the caret in the cell's own
 * structural line. The caret guard keeps a selection out of that line, but a
 * range anchored there reaches a row with `$from` still inside it.
 */
function pickedInColumnLine() {
  const cell = (text: string) =>
    schema.nodes.columnGroup.create(null, [
      schema.nodes.line.create(),
      schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text(text))),
    ]);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.twoColumn.create(null, [schema.nodes.line.create(), cell('left'), cell('right')]),
  ]);
  let cellPos = -1;
  doc.descendants((node, pos) => {
    if (cellPos >= 0) return false;
    if (node.type.name === 'columnGroup') cellPos = pos;
    return true;
  });
  let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, cellPos + 2) });
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

describe('the same guard on a container line', () => {
  it('insertTable refuses a column cell rather than splitting the split around a table', () => {
    const picker = pickedInColumnLine();
    const before = picker.state.doc.toJSON();
    insertTable(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
    expect(picker.state.doc.toJSON()).toEqual(before);
  });

  it('insertTwoColumn refuses it as well', () => {
    const picker = pickedInColumnLine();
    insertTwoColumn(picker.state, picker.dispatch);
    expect(picker.dispatched).toHaveLength(0);
  });
});
