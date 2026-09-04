// @vitest-environment jsdom

/**
 * Where the note's own menu puts its rows.
 *
 * The width and the language are both properties of the document being read,
 * so they share one band between separators. Nothing on screen says that except
 * the order, which is why it is pinned here rather than left to a visual read.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { NoteSummaryDto } from '@/api/types';

import { PaneActions } from './PaneActions';

vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));
vi.mock('@/app/router', () => ({ navigate: vi.fn() }));
// Nothing here should reach the host: this is about the menu's shape alone.
vi.mock('@/api/client', () => ({
  apiFetch: () => Promise.reject(new Error('no requests from this test')),
  apiSend: () => Promise.reject(new Error('no requests from this test')),
}));
vi.mock('@/components/emoji/EmojiPickerPopover', () => ({
  EmojiPickerPopover: () => null,
}));
vi.mock('./NoteHeaderChrome', () => ({ CoverPicker: () => null }));
vi.mock('./useEditorMeasure', () => ({
  EDITOR_WIDTH_KEY: 'Editor.Width',
  useEditorMeasure: () => ({ value: 'Normal' }),
  useEditorWidthOptions: () => [{ value: 'Normal' }, { value: 'Wide' }],
}));
vi.mock('@/settings/store', () => ({
  useSettingsStore: (select: (state: { setValue: unknown }) => unknown) =>
    select({ setValue: () => {} }),
}));
vi.mock('@/trash/undo', () => ({ useUndoDelete: () => () => {} }));
vi.mock('../api', () => ({
  useDeleteNote: () => ({ mutateAsync: vi.fn() }),
  useDuplicateNote: () => ({ mutateAsync: vi.fn() }),
  useUpdateNoteMetadata: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../pdf/store', () => ({
  useNotePdf: (select: (state: { open: unknown }) => unknown) => select({ open: () => {} }),
}));
vi.mock('../transfer/store', () => ({
  useNoteTransfer: (select: (state: { open: unknown }) => unknown) => select({ open: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE = {
  id: 'note-1',
  title: 'Anatomy',
  emoji: null,
  cover: null,
  coverCrop: null,
  isFavorite: false,
} as unknown as NoteSummaryDto;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The menu's own rows and separators, in the order they are drawn. */
function openMenu(): Element[] {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <PaneActions note={NOTE} measureBandAspect={() => 1} />
      </QueryClientProvider>,
    ),
  );
  const trigger = container.querySelector<HTMLElement>('button');
  act(() => {
    trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const menu = document.querySelector("[role='menu']");
  expect(menu, 'the menu did not open').not.toBeNull();
  return [...menu!.children];
}

function labelAt(rows: Element[], index: number): string {
  const row = rows[index];
  if (row?.getAttribute('role') === 'separator') return '<separator>';
  return (row?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

it('puts the language submenu with the width, between the same two separators', () => {
  const rows = openMenu();
  const width = rows.findIndex((_, index) => labelAt(rows, index) === 'EditorWidth');

  expect(width, 'the width submenu is gone').toBeGreaterThan(0);
  expect(labelAt(rows, width - 1)).toBe('<separator>');
  expect(labelAt(rows, width + 1)).toBe('SpellingLanguage');
  expect(labelAt(rows, width + 2)).toBe('<separator>');
});
