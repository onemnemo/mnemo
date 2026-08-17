/**
 * The table block's renderer.
 *
 * The grid is `contentDOM`, so every cell is ordinary ProseMirror content: the
 * caret, marks, undo, find and the clipboard all work inside a cell exactly as
 * they do in a paragraph, and nothing here reimplements any of them. What this
 * adds is the two things a table cannot get from the schema, its geometry and its
 * chrome.
 *
 * ## Layout is one custom property
 *
 * The column widths live on the table node, and they reach the cells as a single
 * `grid-template-columns` value written to this view's own wrapper. The wrapper
 * is outside `contentDOM`, which is what makes that write legal: a style set on
 * an element ProseMirror manages reads back to its observer as a foreign
 * mutation, and the fix for it is not `ignoreMutation`, it is not writing there.
 *
 * Rows are `display: contents`, so the cells are the grid items and a row's
 * height is whatever its tallest cell needs. That is also why nothing here
 * measures a row: the browser already did.
 *
 * ## The chrome is React, and it is not always there
 *
 * Handles, rails, resize strips, the selection band and the menus mount through
 * the portal bridge, because every one of them is an anchored, collision-aware
 * surface and hand-rolling that flip is how a menu ends up half off the screen. A
 * mount with no portal registry (a test, a preview) renders the table itself and
 * no chrome, which is the right degradation: the chrome is what you reach for,
 * and nobody is reaching on a surface that cannot host it.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { createElement } from 'react';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { asOwnUndoStep } from '../history';
import { mountPortalNodeView, type PortalNodeView } from '../view/portal-registry';
import { cellAtPos, cellCaretPos, columnWidths } from './model';
import { TableChrome } from './TableChrome';

const ROOT = 'notes-table';

export function tableView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const { view, services } = args;

  const dom = document.createElement('div');
  dom.className = ROOT;

  const scroll = document.createElement('div');
  scroll.className = `${ROOT}-scroll scroll-thin`;
  dom.appendChild(scroll);

  const frame = document.createElement('div');
  frame.className = `${ROOT}-frame`;
  scroll.appendChild(frame);

  const grid = document.createElement('div');
  grid.className = `${ROOT}-grid`;
  frame.appendChild(grid);

  let chrome: PortalNodeView | null = null;

  function liveNode(): { pos: number; node: PMNode } | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? { pos, node } : null;
  }

  /**
   * Swaps the whole table for a new one, as one undo step.
   *
   * `caret` is where the caller wants to be afterwards, in cell coordinates,
   * because the position it maps to only exists once the new node does. A caller
   * that asks for a cell the new table does not have simply gets no caret move
   * rather than a selection somewhere arbitrary.
   *
   * `addToHistory: false` is for the frames of a drag. A rail drag applies to the
   * real table rather than to a drawing of one, because a drawing cannot show the
   * header row picking up the new column or the text reflowing; but the twenty
   * tables it goes through on the way are not twenty things to undo. The gesture
   * puts the original back with no history and then commits once, so one press of
   * undo takes back the whole drag.
   */
  function replaceTable(
    next: PMNode,
    options: { caret?: { row: number; col: number }; addToHistory?: boolean } = {},
  ): void {
    const live = liveNode();
    if (!live) return;
    const tr = view.state.tr.replaceWith(live.pos, live.pos + live.node.nodeSize, next);
    if (options.caret) {
      const at = cellCaretPos(next, live.pos, options.caret.row, options.caret.col);
      if (at !== null) tr.setSelection(TextSelection.create(tr.doc, at));
    }
    view.dispatch(options.addToHistory === false ? tr.setMeta('addToHistory', false) : asOwnUndoStep(tr));
  }

  /** Puts the caret in a cell of the table as it stands. */
  function focusCell(row: number, col: number): void {
    const live = liveNode();
    if (!live) return;
    const at = cellCaretPos(live.node, live.pos, row, col);
    if (at === null) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    view.focus();
  }

  /**
   * The cell the caret is in, if it is in one at all.
   *
   * The chrome cannot read this off the DOM: ProseMirror's caret lives in the
   * editor's own contentEditable, so `document.activeElement` is the editor and
   * not the cell. The position is the only thing that knows.
   */
  function caretCell(): { row: number; col: number } | null {
    const live = liveNode();
    if (!live) return null;
    return cellAtPos(live.node, live.pos, view.state.selection.from);
  }

  function renderChrome(node: PMNode): void {
    if (!services.portals) return;
    const element = createElement(TableChrome, {
      node,
      frame,
      editable: view.editable,
      replaceTable,
      focusCell,
      caretCell,
    });
    if (chrome) {
      chrome.update(element);
      return;
    }
    chrome = mountPortalNodeView(services.portals, element, { className: `${ROOT}-chrome` });
    frame.appendChild(chrome.dom);
  }

  function render(node: PMNode): void {
    const widths = columnWidths(node);
    const fullWidth = node.attrs.fullWidth === true;
    // One value, on the view's own element: the cells read it and never carry a
    // width of their own, so a column cannot end up with two.
    frame.style.setProperty(
      '--notes-table-cols',
      fullWidth
        ? widths.map((width) => `${width}fr`).join(' ')
        : widths.map((width) => `${width}px`).join(' '),
    );
    frame.style.width = fullWidth ? '100%' : 'max-content';
    dom.toggleAttribute('data-header-row', node.attrs.headerRow === true);
    dom.toggleAttribute('data-header-col', node.attrs.headerCol === true);
    dom.toggleAttribute('data-full-width', fullWidth);
    renderChrome(node);
  }

  render(args.node);

  return {
    dom,
    contentDOM: grid,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      render(node);
      return true;
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false;
      // Only the grid is content. The chrome mount and this view's own style
      // writes on the frame are not, and rebuilding them must not tear the
      // NodeView down mid-drag.
      if (grid.contains(mutation.target)) return false;
      return true;
    },
    destroy(): void {
      chrome?.destroy();
      chrome = null;
    },
  };
}
