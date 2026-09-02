// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoteTitle } from './NoteTitle';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(props: Parameters<typeof NoteTitle>[0]): HTMLHeadingElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<NoteTitle {...props} />));
  return container.querySelector('h1')!;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function type(el: HTMLHeadingElement, text: string): void {
  el.focus();
  el.textContent = text;
}

function press(el: HTMLHeadingElement, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('NoteTitle', () => {
  it('shows the saved title and the placeholder attribute', () => {
    const el = mount({ title: 'Cells', placeholder: 'Untitled note', onCommit: () => {} });
    expect(el.textContent).toBe('Cells');
    expect(el.getAttribute('data-placeholder')).toBe('Untitled note');
  });

  it('commits the trimmed text on blur, and only when it changed', () => {
    const onCommit = vi.fn();
    const el = mount({ title: 'Cells', placeholder: '', onCommit });
    type(el, '  Cells  ');
    act(() => el.blur());
    expect(onCommit).not.toHaveBeenCalled();
    type(el, ' Cell biology ');
    act(() => el.blur());
    expect(onCommit).toHaveBeenCalledWith('Cell biology');
  });

  it('puts the saved title back instead of committing an empty one', () => {
    const onCommit = vi.fn();
    const el = mount({ title: 'Cells', placeholder: '', onCommit });
    type(el, '   ');
    act(() => el.blur());
    expect(onCommit).not.toHaveBeenCalled();
    expect(el.textContent).toBe('Cells');
  });

  it('commits on Enter and hands the caret on', () => {
    const onCommit = vi.fn();
    const onEnter = vi.fn();
    const el = mount({ title: '', placeholder: '', onCommit, onEnter });
    type(el, 'Named');
    press(el, 'Enter');
    expect(onCommit).toHaveBeenCalledWith('Named');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('puts the saved title back on Escape without committing', () => {
    const onCommit = vi.fn();
    const el = mount({ title: 'Cells', placeholder: '', onCommit });
    type(el, 'Typo');
    press(el, 'Escape');
    expect(el.textContent).toBe('Cells');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not replace the text under a caret when the saved title changes', () => {
    const el = mount({ title: 'Cells', placeholder: '', onCommit: () => {} });
    type(el, 'Cells and');
    act(() => root!.render(<NoteTitle title="Cells" placeholder="" onCommit={() => {}} />));
    expect(el.textContent).toBe('Cells and');
    act(() => el.blur());
    act(() => root!.render(<NoteTitle title="Saved" placeholder="" onCommit={() => {}} />));
    expect(el.textContent).toBe('Saved');
  });
});
