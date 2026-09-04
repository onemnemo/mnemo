// @vitest-environment jsdom

/**
 * The card's four answers: replace it, add it, ignore it, or leave it alone.
 *
 * The one that has to be paranoid is the replacement. The card is anchored to a
 * word in a document that keeps moving under it, so it re-derives the range at
 * the moment it writes and refuses when the text is no longer what it was
 * pointing at. Writing at a remembered offset would overwrite whatever had
 * moved into that place.
 *
 * The replacement also has to land wearing the flagged word's own formatting.
 * A resolved position answers with the marks of the node *before* it, so a
 * plain word typed after a bold run came back bold and a word after an inline
 * atom came back with its italic stripped. Both are covered below, because
 * neither is visible in a test that only checks the text.
 */

import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/i18n/store';
import { buildNoteEditState } from '../edit/build-edit-state';
import { blockOf, boldText, equation, italicText, liveSegmentIds, locatedIssueFor, text } from './fixtures';
import { createProofingCard } from './issue-card';
import { proofingIssues, proofingKey, type LocatedIssue } from './proofing-plugin';
import type { InlineSpan } from '../model/types';
import type { ProofingClient } from './client';
import type { ProofingSuggestRequest } from './types';

const ANCHOR = { top: 100, bottom: 120, left: 40, right: 90 };

const BUNDLE = {
  NotesEditor: {
    ProofingMisspelledTitle: 'Misspelled',
    ProofingUnknownWordTitle: 'Unknown word',
    ProofingSuggestionsLoading: 'Finding suggestions',
    ProofingNoSuggestions: 'No suggestions',
    ProofingAddToDictionary: 'Add to dictionary',
    ProofingIgnoreInNote: 'Ignore in this note',
    ProofingCardLabel: 'Spelling',
  },
  Common: { Close: 'Close' },
};

interface Calls {
  /** The scope goes in too: a word added from the card is meant to be unscoped. */
  personal: { word: string; language: string | null | undefined }[];
  ignores: string[];
  resolved: string[];
  suggests: ProofingSuggestRequest[];
}

function stubClient(calls: Calls) {
  return {
    suggest: (request: ProofingSuggestRequest) => {
      calls.suggests.push(request);
      return Promise.resolve({ suggestions: [{ replacement: 'wrong' }, { replacement: 'world' }] });
    },
    addPersonalWord: (word: string, language?: string | null) => {
      calls.personal.push({ word, language });
      return Promise.resolve();
    },
    addNoteIgnore: (_noteId: string, word: string) => {
      calls.ignores.push(word);
      return Promise.resolve();
    },
  } as unknown as ProofingClient;
}

function mountNote(...spans: InlineSpan[]) {
  const built = buildNoteEditState([blockOf({ sid: 'a', spans })]);
  if (!built.ok) throw new Error('quarantined');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  return new EditorView(mount, { state: built.state });
}

interface Harness {
  readonly view: EditorView;
  readonly calls: Calls;
  readonly focused: () => number;
  open(
    word: string,
    over?: Parameters<typeof locatedIssueFor>[3],
    trigger?: 'pointer' | 'keyboard',
  ): LocatedIssue;
  destroy(): void;
}

/**
 * What the card is told the note is checked in. A `let` because the card reads
 * it through a callback at open time, so a settings change reaches an open
 * note, and a constant here would not tell the two apart.
 */
let noteLanguages: string[] = ['en-US'];

function harness(...spans: InlineSpan[]): Harness {
  const view = mountNote(...spans);
  const calls: Calls = { personal: [], ignores: [], resolved: [], suggests: [] };
  // Spied rather than observed through document.activeElement: a contenteditable
  // is not reliably focusable under jsdom, and the claim being made is that the
  // card hands the caret back at all.
  const focus = vi.spyOn(view, 'focus').mockImplementation(() => undefined);
  const handle = createProofingCard({
    view,
    client: stubClient(calls),
    noteId: 'note',
    languages: () => noteLanguages,
    onWordResolved: (word) => calls.resolved.push(word),
  });

  return {
    view,
    calls,
    focused: () => focus.mock.calls.length,
    open(word, over, trigger = 'keyboard') {
      const located = locatedIssueFor(view.state.doc, 'a', word, over);
      view.dispatch(
        view.state.tr.setMeta(proofingKey, {
          type: 'answers',
          liveSegmentIds: liveSegmentIds(view.state.doc),
          segmentIds: [located.issue.segmentId],
          issues: [located],
        }),
      );
      handle.openFor(located, ANCHOR, trigger);
      return located;
    },
    destroy() {
      handle.destroy();
      view.destroy();
    },
  };
}

function card(): HTMLElement | null {
  return document.body.querySelector('.notes-proof-card');
}

function chips(): HTMLButtonElement[] {
  return [...(card()?.querySelectorAll('.notes-proof-card-chip') ?? [])].filter(
    (element): element is HTMLButtonElement => element instanceof HTMLButtonElement,
  );
}

function closeButton(): HTMLButtonElement {
  return actionLabelled('Close');
}

function actionLabelled(label: string): HTMLButtonElement {
  const found = [...(card()?.querySelectorAll('.notes-proof-card-action') ?? [])].find(
    // Trimmed: the leading icon is inline SVG, whose own source whitespace
    // counts as text.
    (button) => (button.textContent ?? '').trim() === label,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no action "${label}"`);
  return found;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/**
 * The marks on the text node holding `word`, by name.
 *
 * Walked rather than resolved from a `textContent` offset: an atom contributes
 * no text but one position, so the two spaces disagree exactly in the document
 * this file cares most about.
 */
function marksOn(view: EditorView, word: string): string[] {
  let names: string[] | null = null;
  view.state.doc.descendants((node) => {
    if (names) return false;
    if (node.isText && (node.text ?? '').includes(word)) names = node.marks.map((mark) => mark.type.name);
    return true;
  });
  return names ?? [];
}

beforeEach(() => {
  useI18nStore.setState({ bundle: BUNDLE });
  noteLanguages = ['en-US'];
});

afterEach(() => {
  useI18nStore.setState({ bundle: {} });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the suggestion card', () => {
  it('shows the tone, the word and the two actions, then fills in suggestions', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');

    expect(card()?.querySelector('.notes-proof-card-title')?.textContent).toBe('Misspelled');
    expect(card()?.querySelector('.notes-proof-card-word')?.textContent).toBe('wrold');
    expect(card()?.querySelector('.notes-proof-card-dot')?.getAttribute('data-tone')).toBe('error');
    expect(card()?.textContent).toContain('Finding suggestions');

    await settle();
    expect(chips().map((chip) => chip.textContent)).toEqual(['wrong', 'world']);
    h.destroy();
  });

  it('keeps its own title when the host names a string this build does not ship', () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold', { titleKey: 'ProofingRepeatedWord' });
    expect(card()?.querySelector('.notes-proof-card-title')?.textContent).toBe('Misspelled');
    h.destroy();
  });

  it('renders a fix that came with the answer as a chip straight away', () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold', { fixes: [{ replacement: 'world' }] });

    expect(card()?.textContent).not.toContain('Finding suggestions');
    expect(chips().map((chip) => chip.textContent)).toEqual(['world']);
    h.destroy();
  });

  it('writes the replacement in one transaction and closes', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');
    await settle();

    const before = h.view.state.doc;
    chips()[0].click();

    expect(h.view.state.doc.textContent).toBe('wrong cat sat');
    expect(h.view.state.doc).not.toBe(before);
    expect(card()).toBeNull();
    h.destroy();
  });

  it('keeps a plain word plain when the run before it is bold', async () => {
    const h = harness(boldText('Hello'), text('wrold done'));
    h.open('wrold');
    await settle();
    chips()[0].click();

    expect(h.view.state.doc.textContent).toBe('Hellowrong done');
    expect(marksOn(h.view, 'Hello')).toEqual(['strong']);
    // The repaired word was never bold, and repairing it must not make it so.
    expect(marksOn(h.view, 'wrong')).toEqual([]);
    h.destroy();
  });

  it('keeps an italic word italic when an atom sits in front of it', async () => {
    const h = harness(text('x '), equation('\\alpha'), italicText('wrold done'));
    h.open('wrold');
    await settle();
    chips()[0].click();

    expect(h.view.state.doc.textContent).toContain('wrong done');
    expect(marksOn(h.view, 'wrong')).toEqual(['em']);
    h.destroy();
  });

  it('refuses to write when the flagged word is no longer there', async () => {
    const h = harness(text('wrold cat sat'));
    const located = h.open('wrold');
    await settle();

    // The word is repaired by hand while the card is open.
    h.view.dispatch(h.view.state.tr.insertText('world', located.from, located.to));
    const repaired = h.view.state.doc.textContent;

    chips()[0].click();
    expect(h.view.state.doc.textContent).toBe(repaired);
    h.destroy();
  });

  it('asks for suggestions in every language the note is checked in', async () => {
    noteLanguages = ['es-ES', 'en-US'];
    const h = harness(text('wrold cat sat'));
    const located = h.open('wrold');
    await settle();

    // The note id goes with it because the note may be checked in a set of its
    // own, and the host resolves the note before it looks at this list.
    expect(h.calls.suggests).toEqual([
      {
        languages: ['es-ES', 'en-US'],
        noteId: 'note',
        text: located.issue.segmentText,
        start: located.issue.segmentStart,
        end: located.issue.segmentEnd,
        ruleId: undefined,
      },
    ]);
    h.destroy();
  });

  it('adds the word to the dictionary, clears its marks and hands the caret back', async () => {
    noteLanguages = ['es-ES', 'en-US'];
    const h = harness(text('wrold cat wrold'));
    h.open('wrold');
    expect(proofingIssues(h.view.state)).toHaveLength(1);

    const before = h.focused();
    actionLabelled('Add to dictionary').click();
    await settle();

    // Unscoped, whatever the note is checked in: the answer is "this is a
    // word", and two dictionaries reading the same paragraph leave no single
    // one to attribute it to.
    expect(h.calls.personal).toEqual([{ word: 'wrold', language: null }]);
    expect(h.calls.resolved).toEqual(['wrold']);
    expect(proofingIssues(h.view.state)).toHaveLength(0);
    expect(card()).toBeNull();
    // The action leaves nothing focused otherwise, and the writer would have to
    // click back into the note to keep typing.
    expect(h.focused()).toBeGreaterThan(before);
    h.destroy();
  });

  it('ignores the word in this note', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');
    actionLabelled('Ignore in this note').click();
    await settle();

    expect(h.calls.ignores).toEqual(['wrold']);
    expect(card()).toBeNull();
    h.destroy();
  });

  it('closes on Escape with the caret restored, and on an outside press without stealing it', () => {
    const h = harness(text('wrold cat sat'));

    h.open('wrold');
    const beforeEscape = h.focused();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card()).toBeNull();
    expect(h.focused()).toBeGreaterThan(beforeEscape);

    h.open('wrold');
    const beforePress = h.focused();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(card()).toBeNull();
    // The press has already chosen where focus goes.
    expect(h.focused()).toBe(beforePress);
    h.destroy();
  });

  it('opens a pointer card without taking the caret out of the document', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold', undefined, 'pointer');
    expect(card()).not.toBeNull();
    // Clicking into a misspelled word is how anyone starts repairing it by
    // hand, so the card may not answer that gesture by moving the caret.
    expect(card()?.contains(document.activeElement)).toBe(false);

    await settle();
    expect(chips()).toHaveLength(2);
    expect(card()?.contains(document.activeElement)).toBe(false);
    h.destroy();
  });

  it('opens a keyboard card on Close while it waits, and never on an action that writes', () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');

    // Before the suggestions arrive the only safe place for the keyboard is the
    // one control that changes nothing.
    expect(document.activeElement).toBe(closeButton());
    expect(chips()).toHaveLength(0);
    h.destroy();
  });

  it('does nothing when Enter is pressed while the suggestions are still coming', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');
    const before = h.view.state.doc;

    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    (document.activeElement as HTMLElement | null)?.click?.();

    // The old first control was Add to dictionary, so this sequence taught the
    // personal dictionary the misspelling.
    expect(h.calls.personal).toEqual([]);
    expect(h.calls.ignores).toEqual([]);
    expect(h.view.state.doc).toBe(before);

    await settle();
    h.destroy();
  });

  it('moves to the first replacement once it exists, and cycles with the arrows and Tab', async () => {
    const h = harness(text('wrold cat sat'));
    h.open('wrold');
    await settle();

    const controls = [
      ...chips(),
      actionLabelled('Add to dictionary'),
      actionLabelled('Ignore in this note'),
      closeButton(),
    ];
    expect(controls).toHaveLength(5);
    // The card exists to offer a replacement, so that is where the keyboard
    // lands the moment there is one.
    expect(document.activeElement).toBe(controls[0]);

    const press = (key: string, shiftKey = false) =>
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));

    press('ArrowDown');
    expect(document.activeElement).toBe(controls[1]);
    press('ArrowRight');
    expect(document.activeElement).toBe(controls[2]);
    press('ArrowUp');
    expect(document.activeElement).toBe(controls[1]);
    // Tab stays inside the card rather than walking out into the page behind it.
    press('Tab', true);
    press('Tab', true);
    expect(document.activeElement).toBe(controls[4]);
    press('Tab');
    expect(document.activeElement).toBe(controls[0]);
    h.destroy();
  });
});
