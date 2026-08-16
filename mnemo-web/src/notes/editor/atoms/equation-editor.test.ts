// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEquationEditor, type EquationEditorOptions } from './equation-editor';

afterEach(() => {
  document.body.replaceChildren();
});

/** Mounts an editor with spy callbacks; the card attaches itself to the body. */
function mount(initialLatex: string, overrides: Partial<EquationEditorOptions> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const onArrowEscape = vi.fn();
  const handle = mountEquationEditor({
    initialLatex,
    onChange,
    onCommit,
    onCancel,
    onArrowEscape,
    ...overrides,
  });
  return { handle, onChange, onCommit, onCancel, onArrowEscape };
}

function press(input: HTMLInputElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

function caretAt(input: HTMLInputElement, index: number): void {
  input.setSelectionRange(index, index);
}

describe('the equation source editor', () => {
  it('opens on the current source, mounted as a floating card on the body', () => {
    const { handle } = mount('x^2');
    expect(handle.input.value).toBe('x^2');
    // Body-level: mounted beside the equation it would sit inside the
    // editor's content, which strips foreign DOM on the next redraw.
    expect(handle.dom.parentNode).toBe(document.body);
  });

  it('reports every keystroke through onChange, without rewriting the source', () => {
    const { handle, onChange } = mount('a');
    handle.input.value = 'a + b';
    handle.input.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a + b');
    // The source of truth is untouched by the preview hook.
    expect(handle.input.value).toBe('a + b');
  });

  it('shows the given placeholder and Done label', () => {
    const { handle } = mount('', { placeholder: 'Type LaTeX', doneLabel: 'Done ↵' });
    expect(handle.input.placeholder).toBe('Type LaTeX');
    expect(handle.dom.querySelector('.notes-equation-flyout-done')?.textContent).toBe('Done ↵');
  });

  it('commits via the Done button, exactly like Enter', () => {
    const { handle, onCommit } = mount('a');
    handle.input.value = 'a + b';
    handle.dom
      .querySelector<HTMLButtonElement>('.notes-equation-flyout-done')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('a + b');
    expect(handle.dom.parentNode).toBeNull();
  });

  it('commits when a pointer lands outside the card, keeping the typed source', () => {
    const { handle, onCommit, onCancel } = mount('a');
    handle.input.value = 'typed';
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('typed');
    expect(onCancel).not.toHaveBeenCalled();
    expect(handle.dom.parentNode).toBeNull();
  });

  it('does not resolve on a pointer inside the card', () => {
    const { handle, onCommit } = mount('a');
    handle.input.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.dom.parentNode).toBe(document.body);
  });

  it('commits the current text on Enter and closes', () => {
    const { handle, onCommit, onCancel } = mount('a');
    handle.input.value = 'a + b';
    const event = press(handle.input, 'Enter');
    expect(event.defaultPrevented).toBe(true);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('a + b');
    expect(onCancel).not.toHaveBeenCalled();
    expect(handle.dom.parentNode).toBeNull();
  });

  it('commits invalid LaTeX verbatim rather than correcting it', () => {
    const { handle, onCommit } = mount('');
    handle.input.value = '\\frac{';
    press(handle.input, 'Enter');
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('\\frac{');
  });

  it('cancels on Escape without committing', () => {
    const { handle, onCommit, onCancel } = mount('a');
    handle.input.value = 'changed';
    const event = press(handle.input, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(handle.dom.parentNode).toBeNull();
  });

  it('escapes before the atom on ArrowLeft from a collapsed caret at the start', () => {
    const { handle, onArrowEscape } = mount('abc');
    caretAt(handle.input, 0);
    const event = press(handle.input, 'ArrowLeft');
    expect(event.defaultPrevented).toBe(true);
    expect(onArrowEscape).toHaveBeenCalledExactlyOnceWith('before', 'abc');
    expect(handle.dom.parentNode).toBeNull();
  });

  it('escapes after the atom on ArrowRight from a collapsed caret at the end', () => {
    const { handle, onArrowEscape } = mount('abc');
    caretAt(handle.input, 3);
    const event = press(handle.input, 'ArrowRight');
    expect(event.defaultPrevented).toBe(true);
    expect(onArrowEscape).toHaveBeenCalledExactlyOnceWith('after', 'abc');
    expect(handle.dom.parentNode).toBeNull();
  });

  it('lets an arrow move within the text instead of escaping', () => {
    const { handle, onArrowEscape } = mount('abc');
    caretAt(handle.input, 1);
    const left = press(handle.input, 'ArrowLeft');
    expect(left.defaultPrevented).toBe(false);
    const right = press(handle.input, 'ArrowRight');
    expect(right.defaultPrevented).toBe(false);
    expect(onArrowEscape).not.toHaveBeenCalled();
    // Still open, a non-boundary arrow is not a resolution.
    expect(handle.dom.parentNode).not.toBeNull();
  });

  it('does not escape right from a non-collapsed selection at the end', () => {
    const { handle, onArrowEscape } = mount('abc');
    // Whole text selected: the right edge is at the end but the caret is not collapsed.
    handle.input.setSelectionRange(0, 3);
    press(handle.input, 'ArrowRight');
    expect(onArrowEscape).not.toHaveBeenCalled();
  });

  it('does not escape left from a selection anchored at the start', () => {
    const { handle, onArrowEscape } = mount('abc');
    // Left edge is at 0, but the selection extends, not a collapsed caret.
    handle.input.setSelectionRange(0, 2);
    const event = press(handle.input, 'ArrowLeft');
    expect(event.defaultPrevented).toBe(false);
    expect(onArrowEscape).not.toHaveBeenCalled();
  });

  it('resolves exactly once, a key after closing does nothing', () => {
    const { handle, onCommit, onCancel } = mount('a');
    press(handle.input, 'Escape');
    press(handle.input, 'Enter');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('focuses the input with the caret at the end', () => {
    const { handle } = mount('abc');
    handle.focus();
    expect(document.activeElement).toBe(handle.input);
    expect(handle.input.selectionStart).toBe(3);
    expect(handle.input.selectionEnd).toBe(3);
  });

  it('destroy removes the editor from the document', () => {
    const { handle } = mount('a');
    handle.destroy();
    expect(handle.dom.parentNode).toBeNull();
  });
});
