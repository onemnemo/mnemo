/**
 * The checklist item's NodeView: a real, clickable checkbox in front of the
 * item's editable text.
 *
 * The CSS-only marker this replaces could not take a click, a pseudo-element
 * receives no events of its own, so the box was decoration pretending to be a
 * control. Here the box is a real button (per the desktop's ChecklistBlock,
 * a CheckBox beside the text editor) and toggling dispatches one transaction,
 * one undo step, exactly like every other structural edit.
 *
 * The button lives outside `contentDOM`, so ProseMirror never treats it as
 * text; `ignoreMutation` additionally owns every mutation inside it so the
 * attribute sync on toggle cannot trigger a defensive redraw.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { asOwnUndoStep } from '../history';

/** The desktop's check glyph: the same path its CheckBox template draws. */
const CHECK_PATH = 'M1 4.5 4 7.5 10 1.5';

export function checklistView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const { view } = args;

  const dom = document.createElement('li');
  dom.setAttribute('data-checklist', '');

  const box = document.createElement('button');
  box.type = 'button';
  box.className = 'notes-checkbox';
  box.setAttribute('contenteditable', 'false');
  box.setAttribute('role', 'checkbox');
  // The editable surface is the tab stop; the box is a pointer affordance,
  // keyboard users toggle through the command surface instead.
  box.tabIndex = -1;
  box.innerHTML =
    `<svg viewBox="0 0 11 9" fill="none" aria-hidden="true">` +
    `<path d="${CHECK_PATH}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const body = document.createElement('div');
  body.className = 'notes-checklist-body';
  dom.append(box, body);

  const sync = (node: PMNode): void => {
    const checked = node.attrs.checked === true;
    dom.setAttribute('data-checked', String(checked));
    box.setAttribute('aria-checked', String(checked));
  };
  sync(args.node);

  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    // The read-only mount renders the same view; it must not offer an edit
    // the autosave cannot persist.
    if (!view.editable) return;
    const pos = args.getPos();
    if (pos === undefined) return;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== args.node.type) return;
    const tr = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: node.attrs.checked !== true,
    });
    view.dispatch(asOwnUndoStep(tr));
  };
  // pointerdown would fire before the editor moves the selection, but a click
  // is the committed gesture; preventDefault on mousedown keeps the caret from
  // jumping into the item on the way.
  const onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };
  box.addEventListener('mousedown', onMouseDown);
  box.addEventListener('click', onClick);

  return {
    dom,
    contentDOM: body,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      sync(node);
      return true;
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false;
      // The attribute sync writes on the item element; everything inside the
      // box is this view's chrome. Content mutations reach the editor.
      return (mutation.type === 'attributes' && mutation.target === dom) || box.contains(mutation.target);
    },
    destroy() {
      box.removeEventListener('mousedown', onMouseDown);
      box.removeEventListener('click', onClick);
    },
  };
}
