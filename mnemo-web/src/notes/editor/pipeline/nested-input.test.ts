// @vitest-environment jsdom

/**
 * The nested-input guard, proved against a live view.
 *
 * The predicate on its own is nearly untestable-by-inspection, of course an
 * `<input>` is an input. What matters is whether the editor's bindings actually
 * stand down for one, and that only shows up with a real `EditorView`, real
 * bubbling and the plugin stack in the order it ships. So each case here is a
 * pair: the same keystroke from inside a field, and from the document.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { mountEditor } from '../view/mount';
import { isNestedTextInput } from './nested-input';

afterEach(() => {
  document.body.replaceChildren();
});

/** An editable view over one text block, with a selection across its content. */
function editorWithSelection() {
  const built = buildNoteEditState([block('Text', [span('abcd')])]);
  if (!built.ok) throw new Error('fixture did not build');

  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const editor = mountEditor({ mount, state: built.state, registry: built.registry });

  editor.view.dispatch(
    editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 2, 6)),
  );
  return editor;
}

/** A text field living inside the editor, the way the equation source popover does. */
function fieldInside(view: { dom: HTMLElement }): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  view.dom.appendChild(input);
  return input;
}

function pressBold(target: EventTarget): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
  );
}

function hasBold(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === 'strong')) found = true;
    return !found;
  });
  return found;
}

describe('isNestedTextInput', () => {
  it('recognises the fields a caret can land in', () => {
    expect(isNestedTextInput(document.createElement('input'))).toBe(true);
    expect(isNestedTextInput(document.createElement('textarea'))).toBe(true);
  });

  it('does not treat editable document content as one', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    // The editor's own root is a contenteditable. Matching it would stand the
    // whole editor down against itself.
    expect(isNestedTextInput(div)).toBe(false);
    expect(isNestedTextInput(null)).toBe(false);
  });
});

describe('a shortcut typed in a field inside the editor', () => {
  it('does not reach the document', () => {
    const editor = editorWithSelection();
    const input = fieldInside(editor.view);

    pressBold(input);

    expect(hasBold(editor.view.state.doc)).toBe(false);
    editor.destroy();
  });

  it('is not blocked from reaching the field', () => {
    const editor = editorWithSelection();
    const input = fieldInside(editor.view);
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(event);

    // Standing ProseMirror down must not also cancel the keystroke, the field
    // is where it was going. This is why the guard hooks `handleDOMEvents` and
    // not `handleKeyDown`, which calls `preventDefault` on a handled key.
    expect(event.defaultPrevented).toBe(false);
    editor.destroy();
  });
});

describe('the same shortcut typed in the document', () => {
  it('still runs', () => {
    const editor = editorWithSelection();

    pressBold(editor.view.dom);

    expect(hasBold(editor.view.state.doc)).toBe(true);
    editor.destroy();
  });
});
