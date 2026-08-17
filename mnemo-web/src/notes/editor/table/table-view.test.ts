// @vitest-environment jsdom

/**
 * The table's view: that the cells stay ProseMirror's, and that the layout is
 * written where ProseMirror is not watching.
 *
 * The second half is the one that bites. A style set on an element ProseMirror
 * manages reads back to its observer as a foreign mutation and gets the NodeView
 * torn down and rebuilt, so where the column widths are written is a correctness
 * property and not a tidiness one.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { resolveServices } from '../view/nodeviews';
import type { BlockShellHost, RealizedBlockViewArgs } from '../registry/types';
import { createTable, columnWidths, tableRows } from './model';
import { tableView } from './table-view';

const { schema } = createEditorSchema();
const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };

function mount(attrs: Record<string, unknown> = {}, editable = true) {
  const fresh = createTable(schema, 2, 3);
  const node = fresh.type.create({ ...fresh.attrs, ...attrs }, fresh.content);
  const doc = schema.nodes.doc.create(null, [node]);
  let state = EditorState.create({ schema, doc });
  const view = {
    get state() {
      return state;
    },
    editable,
    focus() {},
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    // No portal registry: a harness with no React tree beside it must still get a
    // working table, minus the chrome.
    services: resolveServices(),
  };
  return { realized: tableView(args), doc };
}

describe('table NodeView', () => {
  it('hands ProseMirror the grid and nothing else', () => {
    const { realized } = mount();
    const grid = realized.dom.querySelector('.notes-table-grid');
    expect(realized.contentDOM).toBe(grid);
  });

  it('writes the track list on its own element, outside the content', () => {
    const { realized } = mount({ columnWidths: [200, 160, 140] });
    const frame = realized.dom.querySelector<HTMLElement>('.notes-table-frame')!;
    expect(frame.style.getPropertyValue('--notes-table-cols')).toBe('200px 160px 140px');
    // The frame is the wrapper, never inside the grid ProseMirror manages.
    expect(realized.contentDOM!.contains(frame)).toBe(false);
  });

  it('switches the tracks to fractions when the table is fitted to the pane', () => {
    const { realized } = mount({ columnWidths: [200, 100, 100], fullWidth: true });
    const frame = realized.dom.querySelector<HTMLElement>('.notes-table-frame')!;
    expect(frame.style.getPropertyValue('--notes-table-cols')).toBe('200fr 100fr 100fr');
    expect(frame.style.width).toBe('100%');
    expect(realized.dom.hasAttribute('data-full-width')).toBe(true);
  });

  it('flags the header row and column for the stylesheet', () => {
    const { realized } = mount({ headerRow: true, headerCol: true });
    expect(realized.dom.hasAttribute('data-header-row')).toBe(true);
    expect(realized.dom.hasAttribute('data-header-col')).toBe(true);
  });

  it('renders with no portal registry, minus the chrome', () => {
    const { realized } = mount();
    expect(realized.dom.querySelector('.notes-table-chrome')).toBeNull();
    expect(realized.contentDOM).not.toBeNull();
  });

  it('claims every mutation outside the grid', () => {
    const { realized } = mount();
    const frame = realized.dom.querySelector('.notes-table-frame')!;
    expect(realized.ignoreMutation!({ type: 'attributes', target: frame } as never)).toBe(true);
    expect(realized.ignoreMutation!({ type: 'childList', target: realized.contentDOM! } as never)).toBe(false);
    expect(realized.ignoreMutation!({ type: 'selection', target: frame } as never)).toBe(false);
  });

  it('follows the widths through an update rather than rebuilding', () => {
    const { realized, doc } = mount({ columnWidths: [180, 180, 180] });
    const table = doc.firstChild!;
    const wider = table.type.create({ ...table.attrs, columnWidths: [300, 180, 180] }, table.content);
    expect(realized.update!(wider)).toBe(true);
    const frame = realized.dom.querySelector<HTMLElement>('.notes-table-frame')!;
    expect(frame.style.getPropertyValue('--notes-table-cols')).toBe('300px 180px 180px');
  });

  it('reads a table whose stored widths are short without leaving a track blank', () => {
    const { realized } = mount({ columnWidths: [200] });
    const frame = realized.dom.querySelector<HTMLElement>('.notes-table-frame')!;
    expect(frame.style.getPropertyValue('--notes-table-cols').split(' ')).toHaveLength(3);
  });
});

describe('the built table', () => {
  it('starts as a rectangle with a width per column', () => {
    const table = createTable(schema, 3, 3);
    expect(tableRows(table)).toHaveLength(3);
    expect(columnWidths(table)).toHaveLength(3);
  });
});
