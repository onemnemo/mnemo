// @vitest-environment jsdom

/**
 * The card's four answers: replace it, add it, ignore it, or leave it alone.
 *
 * The one that has to be paranoid is the replacement. The card is anchored to a
 * word in a document that keeps moving under it, so it re-derives the range at
 * the moment it writes and refuses when the text is no longer what it was
 * pointing at. Writing at a remembered offset would overwrite whatever had
 * moved into that place.
 */

import { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18nStore } from '@/i18n/store';
import { buildNoteEditState } from '../edit/build-edit-state';
import { projectDocument } from '../editor/projection/document';
import { blockOf, text } from './fixtures';
import { createProofingCard } from './issue-card';
import { getProofingState, proofingKey, type PlacedIssue } from './proofing-plugin';
import { checkableSegments, resolveRange } from './segments';
import type { ProofingClient } from './client';

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
};

interface Calls {
  personal: string[];
  ignores: string[];
  resolved: string[];
}

function stubClient(calls: Calls) {
  return {
    suggest: () => Promise.resolve({ suggestions: [{ replacement: 'the' }, { replacement: 'ten' }] }),
    addPersonalWord: (word: string) => {
      calls.personal.push(word);
      return Promise.resolve();
    },
    addNoteIgnore: (_noteId: string, word: string) => {
      calls.ignores.push(word);
      return Promise.resolve();
    },
  } as unknown as ProofingClient;
}

function mountNote(value: string) {
  const built = buildNoteEditState([blockOf({ sid: 'a', spans: [text(value)] })]);
  if (!built.ok) throw new Error('quarantined');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state: built.state });
  return { view, registry: built.registry };
}

function issueFor(view: EditorView, registry: never, word: string): PlacedIssue {
  const doc = view.state.doc;
  const projection = projectDocument(doc, registry);
  const segment = checkableSegments(doc, registry)[0];
  const start = segment.text.indexOf(word);
  const range = resolveRange(doc, projection, segment, start, start + word.length, word);
  if (!range) throw new Error('unresolvable');
  return {
    segmentId: segment.id,
    from: range.from,
    to: range.to,
    text: word,
    kind: 'spelling',
    tone: 'error',
    segmentText: segment.text,
    segmentStart: start,
    segmentEnd: start + word.length,
  };
}

function card(): HTMLElement | null {
  return document.body.querySelector('.notes-proof-card');
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

beforeEach(() => {
  useI18nStore.setState({ bundle: BUNDLE });
});

afterEach(() => {
  useI18nStore.setState({ bundle: {} });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the suggestion card', () => {
  it('shows the tone, the word and the two actions, then fills in suggestions', async () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    handle.openFor(issueFor(view, registry as never, 'teh'), ANCHOR);

    expect(card()?.querySelector('.notes-proof-card-title')?.textContent).toBe('Misspelled');
    expect(card()?.querySelector('.notes-proof-card-word')?.textContent).toBe('teh');
    expect(card()?.querySelector('.notes-proof-card-dot')?.getAttribute('data-tone')).toBe('error');
    expect(card()?.textContent).toContain('Finding suggestions');

    await settle();
    expect([...(card()?.querySelectorAll('.notes-proof-card-chip') ?? [])].map((chip) => chip.textContent)).toEqual([
      'the',
      'ten',
    ]);

    handle.destroy();
    view.destroy();
  });

  it('keeps its own title when the host names a string this build does not ship', () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    const issue = { ...issueFor(view, registry as never, 'teh'), titleKey: 'ProofingRepeatedWord' };
    handle.openFor(issue, ANCHOR);

    expect(card()?.querySelector('.notes-proof-card-title')?.textContent).toBe('Misspelled');

    handle.destroy();
    view.destroy();
  });

  it('renders a fix that came with the answer as a chip straight away', () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    const issue = { ...issueFor(view, registry as never, 'teh'), fixes: [{ replacement: 'the' }] };
    handle.openFor(issue, ANCHOR);

    expect(card()?.textContent).not.toContain('Finding suggestions');
    expect(card()?.querySelector('.notes-proof-card-chip')?.textContent).toBe('the');

    handle.destroy();
    view.destroy();
  });

  it('writes the replacement in one transaction and closes', async () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    const issue = issueFor(view, registry as never, 'teh');
    view.dispatch(view.state.tr.setMeta(proofingKey, { type: 'answers', segmentIds: [issue.segmentId], issues: [issue] }));
    handle.openFor(issue, ANCHOR);
    await settle();

    const before = view.state.doc;
    const chip = card()?.querySelector('.notes-proof-card-chip');
    expect(chip).toBeInstanceOf(HTMLButtonElement);
    if (chip instanceof HTMLButtonElement) chip.click();

    expect(view.state.doc.textContent).toBe('the cat sat');
    expect(view.state.doc).not.toBe(before);
    expect(card()).toBeNull();

    handle.destroy();
    view.destroy();
  });

  it('refuses to write when the flagged word is no longer there', async () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    const issue = issueFor(view, registry as never, 'teh');
    view.dispatch(view.state.tr.setMeta(proofingKey, { type: 'answers', segmentIds: [issue.segmentId], issues: [issue] }));
    handle.openFor(issue, ANCHOR);
    await settle();

    // The word is repaired by hand while the card is open.
    view.dispatch(view.state.tr.insertText('the', issue.from, issue.to));
    const repaired = view.state.doc.textContent;

    const chip = card()?.querySelector('.notes-proof-card-chip');
    expect(chip).toBeInstanceOf(HTMLButtonElement);
    if (chip instanceof HTMLButtonElement) chip.click();
    expect(view.state.doc.textContent).toBe(repaired);

    handle.destroy();
    view.destroy();
  });

  it('adds the word to the dictionary and clears its marks across the note', async () => {
    const { view, registry } = mountNote('teh cat teh');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    const issue = issueFor(view, registry as never, 'teh');
    view.dispatch(view.state.tr.setMeta(proofingKey, { type: 'answers', segmentIds: [issue.segmentId], issues: [issue] }));
    expect(getProofingState(view.state).issues).toHaveLength(1);

    handle.openFor(issue, ANCHOR);
    actionLabelled('Add to dictionary').click();
    await settle();

    expect(calls.personal).toEqual(['teh']);
    expect(calls.resolved).toEqual(['teh']);
    expect(getProofingState(view.state).issues).toHaveLength(0);
    expect(card()).toBeNull();

    handle.destroy();
    view.destroy();
  });

  it('ignores the word in this note', async () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note-7',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });

    handle.openFor(issueFor(view, registry as never, 'teh'), ANCHOR);
    actionLabelled('Ignore in this note').click();
    await settle();

    expect(calls.ignores).toEqual(['teh']);
    expect(card()).toBeNull();

    handle.destroy();
    view.destroy();
  });

  it('closes on Escape and on a press outside itself', () => {
    const { view, registry } = mountNote('teh cat sat');
    const calls: Calls = { personal: [], ignores: [], resolved: [] };
    const handle = createProofingCard({
      view,
      client: stubClient(calls),
      noteId: 'note',
      language: () => 'en-US',
      onWordResolved: (word) => calls.resolved.push(word),
    });
    const issue = issueFor(view, registry as never, 'teh');

    handle.openFor(issue, ANCHOR);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card()).toBeNull();

    handle.openFor(issue, ANCHOR);
    expect(card()).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(card()).toBeNull();

    handle.destroy();
    view.destroy();
  });
});
