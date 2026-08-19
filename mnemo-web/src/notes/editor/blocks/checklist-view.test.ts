// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { checklistView } from './checklist-view';
import type { BlockShellHost, EditorServices, RealizedBlockViewArgs } from '../registry/types';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function item(checked: boolean, text = 'task'): PMNode {
  return schema.nodes.checklistItem.create({ checked }, line(text));
}

const host: BlockShellHost = { mode: 'realized', requestMode() {}, destroy() {} };
const services: EditorServices = {
  resolveNoteTitle: () => undefined,
  loadAssetUrl: () => Promise.reject(new Error('none')),
  uploadAsset: () => Promise.reject(new Error('none')),
};

/** A view double carrying a real state, so the toggle builds a real transaction. */
function mountItem(checked: boolean, editable = true) {
  const doc = schema.nodes.doc.create(null, [item(checked)]);
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const view = {
    get state() {
      return state;
    },
    editable,
    dispatch(tr: Transaction) {
      dispatched.push(tr);
      state = state.apply(tr);
    },
  } as unknown as EditorView;

  const args: RealizedBlockViewArgs<Record<string, unknown>> = {
    node: doc.firstChild!,
    view,
    getPos: () => 0,
    attrs: doc.firstChild!.attrs,
    host,
    services,
  };
  const realized = checklistView(args);
  return { realized, dispatched, currentState: () => state };
}

function clickBox(realized: ReturnType<typeof mountItem>['realized']): void {
  realized.dom
    .querySelector('.notes-checkbox')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('checklist NodeView', () => {
  it('renders the box outside the editable body and mirrors the checked state', () => {
    const { realized } = mountItem(true);
    expect(realized.dom.tagName).toBe('LI');
    expect(realized.dom.getAttribute('data-checklist')).toBe('');
    expect(realized.dom.getAttribute('data-checked')).toBe('true');
    const box = realized.dom.querySelector('.notes-checkbox')!;
    expect(box.getAttribute('role')).toBe('checkbox');
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.getAttribute('contenteditable')).toBe('false');
    // The editable content lives in the body, never inside the button.
    expect(realized.contentDOM).toBe(realized.dom.querySelector('.notes-checklist-body'));
    expect(box.contains(realized.contentDOM!)).toBe(false);
  });

  it('keeps the box in Tab order: it is the only way to toggle it by keyboard', () => {
    const { realized } = mountItem(false);
    const box = realized.dom.querySelector('.notes-checkbox')!;
    expect((box as HTMLElement).tabIndex).toBe(0);
  });

  it('toggles through one own-undo-step transaction on click', () => {
    const { realized, dispatched, currentState } = mountItem(false);
    clickBox(realized);
    expect(dispatched).toHaveLength(1);
    expect(currentState().doc.firstChild!.attrs.checked).toBe(true);
    // A second click toggles back rather than latching.
    clickBox(realized);
    expect(currentState().doc.firstChild!.attrs.checked).toBe(false);
  });

  it('keeps the DOM state in sync when the document changes underneath', () => {
    const { realized } = mountItem(false);
    expect(realized.update!(item(true))).toBe(true);
    expect(realized.dom.getAttribute('data-checked')).toBe('true');
    expect(realized.dom.querySelector('.notes-checkbox')!.getAttribute('aria-checked')).toBe('true');
  });

  it('refuses an update to a different node type', () => {
    const { realized } = mountItem(false);
    const para = schema.nodes.paragraph.create(null, line('x'));
    expect(realized.update!(para)).toBe(false);
  });

  it('does not toggle in a read-only view', () => {
    const { realized, dispatched } = mountItem(false, false);
    clickBox(realized);
    expect(dispatched).toHaveLength(0);
  });

  it('owns its chrome mutations and nothing in the body', () => {
    const { realized } = mountItem(false);
    const box = realized.dom.querySelector('.notes-checkbox')!;
    const attrOnItem = { type: 'attributes', target: realized.dom } as unknown as MutationRecord;
    const insideBox = { type: 'childList', target: box } as unknown as MutationRecord;
    const inBody = { type: 'characterData', target: realized.contentDOM! } as unknown as MutationRecord;
    const selection = { type: 'selection', target: realized.contentDOM! } as const;
    expect(realized.ignoreMutation!(attrOnItem)).toBe(true);
    expect(realized.ignoreMutation!(insideBox)).toBe(true);
    expect(realized.ignoreMutation!(inBody)).toBe(false);
    expect(realized.ignoreMutation!(selection)).toBe(false);
  });
});
