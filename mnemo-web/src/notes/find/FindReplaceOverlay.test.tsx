// @vitest-environment jsdom

/**
 * The find/replace bar used to hardcode every label in English, with no
 * translation key backing any of it. This mounts the real overlay against
 * the real `useT`/`useI18nStore` (only `useNoteFind` is stubbed, the same
 * way `CardEditorOverlay.test.tsx` stubs its own data hooks) and checks that
 * every visible string, including the toggle whose wording depends on
 * `replaceOpen`, comes from the active bundle rather than a literal.
 */

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { useI18nStore } from '../../i18n/store';
import type { BlockRegistry } from '../editor/registry/build';
import { FindReplaceOverlay } from './FindReplaceOverlay';

const findState = vi.hoisted(() => ({
  open: true,
  query: '',
  replaceText: '',
  replaceOpen: false,
  caseSensitive: false,
  wholeWord: false,
  count: 0,
  activeIndex: -1,
  setQuery: vi.fn(),
  setReplaceText: vi.fn(),
  close: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  toggleCaseSensitive: vi.fn(),
  toggleWholeWord: vi.fn(),
  toggleReplaceOpen: vi.fn(),
  replaceAll: vi.fn(),
  replaceCurrent: vi.fn(),
}));

vi.mock('./useNoteFind', () => ({
  useNoteFind: () => findState,
}));

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BUNDLE = {
  NotesEditor: {
    FindAndReplaceLabel: 'Find and replace',
    FindTextPlaceholder: 'Find text',
    FindClose: 'Close',
    FindPreviousMatch: 'Previous match',
    FindNextMatch: 'Next match',
    FindMatchCaseLabel: 'Aa',
    FindMatchCaseTitle: 'Match case',
    FindWholeWordLabel: 'Word',
    FindWholeWordTitle: 'Match whole word',
    FindReplaceToggleOn: 'Replace on',
    FindReplaceToggleOff: 'Replace off',
    ReplaceWithPlaceholder: 'Replace with',
    FindReplaceAll: 'All',
    FindReplaceCurrent: 'Replace',
  },
};

// A second, deliberately distinct bundle: proves the strings are read live
// from the store rather than baked in at import time.
const OTHER_BUNDLE = {
  NotesEditor: {
    ...BUNDLE.NotesEditor,
    FindAndReplaceLabel: 'Suchen und ersetzen',
    FindTextPlaceholder: 'Text suchen',
    FindReplaceToggleOff: 'Ersetzen aus',
    FindReplaceToggleOn: 'Ersetzen ein',
  },
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  findState.open = true;
  findState.replaceOpen = false;
  findState.count = 0;
  findState.activeIndex = -1;
  useI18nStore.setState({ bundle: BUNDLE });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useI18nStore.setState({ bundle: {} });
});

function mount(node: ReactNode): void {
  act(() => root.render(node));
}

function fakeView(): EditorView {
  const dom = document.createElement('div');
  container.appendChild(dom);
  return { dom } as unknown as EditorView;
}

const registry = {} as BlockRegistry;

describe('the find/replace overlay', () => {
  it('renders every chrome string from the active bundle, not a literal', () => {
    mount(<FindReplaceOverlay view={fakeView()} registry={registry} />);

    const root_ = container.querySelector('.notes-find-replace') as HTMLElement;
    expect(root_.getAttribute('aria-label')).toBe('Find and replace');
    expect(container.querySelector('.notes-find-input')?.getAttribute('placeholder')).toBe('Find text');
    expect(container.querySelector('[aria-label="Close"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Previous match"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Next match"]')).not.toBeNull();
    expect(container.querySelector('.notes-find-chip[title="Match case"]')?.textContent).toBe('Aa');
    expect(container.querySelector('.notes-find-chip[title="Match whole word"]')?.textContent).toBe('Word');
    expect(container.querySelector('.notes-find-toggle')?.textContent).toContain('Replace off');
  });

  it('flips the replace toggle label with replaceOpen, not a static word', () => {
    findState.replaceOpen = true;
    mount(<FindReplaceOverlay view={fakeView()} registry={registry} />);

    expect(container.querySelector('.notes-find-toggle')?.textContent).toContain('Replace on');
    expect(container.querySelector('.notes-find-replace-input')?.getAttribute('placeholder')).toBe('Replace with');
    const actions = container.querySelectorAll('.notes-find-action');
    expect(actions[0]?.textContent).toBe('All');
    expect(actions[1]?.textContent).toBe('Replace');
  });

  it('follows a language switch without a remount', () => {
    mount(<FindReplaceOverlay view={fakeView()} registry={registry} />);
    expect(container.querySelector('.notes-find-input')?.getAttribute('placeholder')).toBe('Find text');

    act(() => useI18nStore.setState({ bundle: OTHER_BUNDLE }));

    expect(container.querySelector('.notes-find-input')?.getAttribute('placeholder')).toBe('Text suchen');
    const root_ = container.querySelector('.notes-find-replace') as HTMLElement;
    expect(root_.getAttribute('aria-label')).toBe('Suchen und ersetzen');
  });

  it('falls back to the key itself when a bundle has no entry, same as useT everywhere else', () => {
    useI18nStore.setState({ bundle: {} });
    mount(<FindReplaceOverlay view={fakeView()} registry={registry} />);

    expect(container.querySelector('.notes-find-input')?.getAttribute('placeholder')).toBe('FindTextPlaceholder');
  });
});
