// @vitest-environment jsdom

/**
 * The way back out of "Ignore in this note".
 *
 * That action is one click on a card that closes behind it, so an accidental
 * click needs a list to be seen in and taken back from. Both halves are pinned
 * here: the list, and a removal that offers the undo rather than asking the
 * reader to remember the word.
 */

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/i18n/store';
import { PROOFING_IGNORES_KEY } from '@/notes/proofing/status';

import { ProofingIgnoresDialog } from './ProofingIgnoresDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE_ID = 'note-a';

const BUNDLE = {
  Common: { Close: 'Close', Error: 'Something went wrong', Undo: 'Undo', Retry: 'Try again' },
  Notes: {
    SpellingIgnoredTitle: 'Ignored in this note',
    SpellingIgnoredSubtitle: 'Words this note accepts.',
    SpellingIgnoredEmpty: 'Nothing is ignored here yet.',
    SpellingIgnoredLoading: 'Loading.',
    SpellingIgnoredFailed: 'The list could not be loaded.',
    SpellingIgnoreLiftFormat: 'Check {0} again',
    SpellingIgnoreLiftedFormat: '{0} is checked again.',
  },
};

const mocks = vi.hoisted(() => {
  let state: string[] = [];
  const list = () => ({ words: [...state] });
  return {
    setWords(words: string[]) {
      state = [...words];
    },
    list,
    toastInfo: vi.fn(),
    toastWarning: vi.fn(),
    noteIgnores: vi.fn(() => Promise.resolve(list())),
    addNoteIgnore: vi.fn((_noteId: string, word: string) => {
      if (!state.includes(word)) state.push(word);
      return Promise.resolve(list());
    }),
    removeNoteIgnore: vi.fn((_noteId: string, word: string) => {
      state = state.filter((entry) => entry !== word);
      return Promise.resolve(list());
    }),
  };
});

vi.mock('@/notes/proofing/client', () => ({
  createProofingClient: () => ({
    noteIgnores: mocks.noteIgnores,
    addNoteIgnore: mocks.addNoteIgnore,
    removeNoteIgnore: mocks.removeNoteIgnore,
  }),
}));

vi.mock('@/stores/toast', () => ({
  toast: { info: mocks.toastInfo, warning: mocks.toastWarning },
}));

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  useI18nStore.setState({ bundle: BUNDLE, ready: true });
  mocks.setWords([]);
  mocks.toastInfo.mockClear();
  mocks.toastWarning.mockClear();
  mocks.noteIgnores.mockClear();
  mocks.addNoteIgnore.mockClear();
  mocks.removeNoteIgnore.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Seeds the cache from the fake's current words, so no fetch is needed to render. */
function render(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData([...PROOFING_IGNORES_KEY, NOTE_ID], mocks.list());
  act(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <ProofingIgnoresDialog noteId={NOTE_ID} onClose={() => {}} />
        </QueryClientProvider>
      </StrictMode>,
    );
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The words on screen: each row is a word beside the button that lifts it. */
function rows(): (string | undefined)[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="dialog"] p')]
    .filter((node) => node.nextElementSibling instanceof HTMLButtonElement)
    .map((node) => node.textContent?.trim());
}

describe('the words a note ignores', () => {
  it('lists them from A to Z', () => {
    mocks.setWords(['myocyte', 'glycolysis']);
    render();
    expect(rows()).toEqual(['glycolysis', 'myocyte']);
  });

  it('says so when nothing is ignored, rather than showing an empty box', () => {
    render();
    expect(document.body.textContent).toContain('Nothing is ignored here yet.');
  });

  it('checks a word again, and offers the way back', async () => {
    mocks.setWords(['myocyte']);
    render();

    const lift = document.body.querySelector<HTMLElement>('[aria-label="Check myocyte again"]');
    act(() => lift?.click());
    await flush();

    expect(mocks.removeNoteIgnore).toHaveBeenCalledWith(NOTE_ID, 'myocyte');
    expect(rows()).toEqual([]);

    const [title, options] = mocks.toastInfo.mock.calls[0] as [string, { primary: { onClick: () => void } }];
    expect(title).toBe('myocyte is checked again.');
    await act(async () => options.primary.onClick());
    await flush();
    expect(mocks.addNoteIgnore).toHaveBeenCalledWith(NOTE_ID, 'myocyte');
    expect(rows()).toEqual(['myocyte']);
  });
});
