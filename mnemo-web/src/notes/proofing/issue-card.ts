/**
 * The card you get when you ask about a marked word.
 *
 * A body-level, viewport-positioned element, the same floating-card idiom the
 * link flyout and the equation editor already use here: mounted outside the
 * ProseMirror content so its own DOM is never read back as document
 * corruption, and dismissed on an outside press, on Escape and on a scroll,
 * because it is anchored to a box in a document that scrolls out from under it.
 *
 * Three parts, in this order: what kind of thing this is, the word, and the
 * replacements as something to press. Then the two answers that are not a
 * replacement at all, adding the word to the dictionary and ignoring it in this
 * note. The tone dot is the only colour on the card, which is what lets it be
 * read at a glance rather than decoded.
 *
 * A fix that came with the answer is a chip immediately. Suggestions are asked
 * for when the card opens, because computing them is an order of magnitude
 * dearer than finding the mistake and almost every mark is never opened.
 */

import type { EditorView } from 'prosemirror-view';
import { getIconMarkup } from '@/components/icon/icon-registry';
import { useI18nStore } from '@/i18n/store';
import { createTranslate } from '@/i18n/translate';
import { asOwnUndoStep } from '../editor/history/boundaries';
import { openTransientFocus, type TransientFocusScope } from '../editor/focus';
import type { Rect } from '../editor/floating/position';
import type { ProofingClient } from './client';
import {
  currentIssue,
  dispatchProofing,
  issueIdOf,
  type PlacedIssue,
} from './proofing-plugin';
import type { ProofingSuggestion } from './types';

const ROOT = 'notes-proof-card';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/**
 * The string for a key the host chose, or null when this build does not ship
 * one. A missing key translates to the key itself, and `spelling.repeatedWord`
 * as a card's title reads as a broken app rather than as a missing string, so
 * the card falls back to what it can name on its own.
 */
function hostString(key: string | undefined): string | null {
  if (!key) return null;
  return useI18nStore.getState().bundle.NotesEditor?.[key] ?? null;
}

/** Below the anchor, left-aligned, clamped into the viewport, flipped when it will not fit. */
function placeAt(dom: HTMLElement, anchor: Rect): void {
  const width = dom.offsetWidth;
  const height = dom.offsetHeight;
  dom.style.left = `${String(Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)))}px`;
  let top = anchor.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 6);
  dom.style.top = `${String(top)}px`;
}

function titleFor(issue: PlacedIssue): string {
  return (
    hostString(issue.titleKey) ??
    translate(issue.tone === 'unknown' ? 'ProofingUnknownWordTitle' : 'ProofingMisspelledTitle')
  );
}

function actionButton(iconName: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${ROOT}-action`;
  const icon = getIconMarkup(iconName);
  if (icon) {
    const slot = document.createElement('span');
    slot.className = `${ROOT}-action-icon`;
    slot.innerHTML = icon;
    button.appendChild(slot);
  }
  const text = document.createElement('span');
  text.textContent = label;
  button.appendChild(text);
  return button;
}

export interface ProofingCardOptions {
  readonly view: EditorView;
  readonly client: ProofingClient;
  /** The effective language, read at open time so a settings change is picked up. */
  language(): string;
  readonly noteId: string;
  /** Called after the word stops being checkable, so its other marks can go. */
  onWordResolved(word: string): void;
}

export interface ProofingCardHandle {
  openFor(issue: PlacedIssue, anchor: Rect): void;
  contains(node: Node): boolean;
  close(): void;
  destroy(): void;
}

export function createProofingCard(options: ProofingCardOptions): ProofingCardHandle {
  const { view, client, noteId } = options;

  let dom: HTMLElement | null = null;
  let focusScope: TransientFocusScope | null = null;
  let openIssue: PlacedIssue | null = null;
  let requestId = 0;

  function contains(node: Node): boolean {
    return dom?.contains(node) ?? false;
  }

  function close(): void {
    if (!dom) return;
    requestId += 1;
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('scroll', close, true);
    window.removeEventListener('resize', close);
    dom.remove();
    dom = null;
    openIssue = null;
    const scope = focusScope;
    focusScope = null;
    scope?.release();
    if (!view.isDestroyed) dispatchProofing(view, { type: 'open', openId: null });
  }

  function onOutsidePointer(event: PointerEvent): void {
    if (event.target instanceof Node && contains(event.target)) return;
    close();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
    view.focus();
  }

  /**
   * Writes a replacement over the flagged word in one transaction.
   *
   * The range is taken from the live plugin state rather than from the issue
   * the card opened with: an edit that landed while the card was open moves
   * every position after it, and a replacement written at a remembered offset
   * would overwrite whatever moved into that place. A word that no longer
   * matches is not replaced at all.
   */
  function apply(replacement: string): void {
    const issue = openIssue;
    close();
    if (!issue) return;
    const live = currentIssue(view.state, issue);
    if (!live) return;
    if (view.state.doc.textBetween(live.from, live.to) !== live.text) return;

    const marks = view.state.doc.resolve(live.from).marks();
    const tr = view.state.tr;
    if (replacement.length === 0) tr.delete(live.from, live.to);
    else tr.replaceWith(live.from, live.to, view.state.schema.text(replacement, marks));
    view.dispatch(asOwnUndoStep(tr));
    view.focus();
  }

  function resolveWord(word: string, work: Promise<void>): void {
    close();
    void work
      .then(() => {
        if (view.isDestroyed) return;
        dispatchProofing(view, { type: 'dropWord', word });
        options.onWordResolved(word);
      })
      .catch(() => {
        // The word stays marked, which is the honest report of a write that
        // did not land. The toast belongs to whoever owns the failure surface.
      });
  }

  function chipsInto(host: HTMLElement, suggestions: readonly ProofingSuggestion[]): void {
    host.textContent = '';
    if (suggestions.length === 0) {
      const empty = document.createElement('p');
      empty.className = `${ROOT}-note`;
      empty.textContent = translate('ProofingNoSuggestions');
      host.appendChild(empty);
      return;
    }
    for (const suggestion of suggestions) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `${ROOT}-chip`;
      chip.textContent = suggestion.label ?? suggestion.replacement;
      chip.addEventListener('click', () => {
        apply(suggestion.replacement);
      });
      host.appendChild(chip);
    }
  }

  function openFor(issue: PlacedIssue, anchor: Rect): void {
    close();

    const card = document.createElement('div');
    card.className = ROOT;
    // Never let ProseMirror read this card's own DOM as document content.
    card.setAttribute('contenteditable', 'false');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', translate('ProofingCardLabel'));

    const heading = document.createElement('div');
    heading.className = `${ROOT}-heading`;
    const dot = document.createElement('span');
    dot.className = `${ROOT}-dot`;
    dot.setAttribute('data-tone', issue.tone);
    const title = document.createElement('p');
    title.className = `${ROOT}-title`;
    title.textContent = titleFor(issue);
    heading.append(dot, title);

    const word = document.createElement('p');
    word.className = `${ROOT}-word`;
    word.textContent = issue.text;

    const message = document.createElement('p');
    message.className = `${ROOT}-note`;
    message.textContent = hostString(issue.messageKey) ?? '';
    message.hidden = message.textContent.length === 0;

    const chips = document.createElement('div');
    chips.className = `${ROOT}-chips`;
    const fixes = issue.fixes ?? [];
    if (fixes.length > 0) chipsInto(chips, fixes.map((fix) => ({ replacement: fix.replacement, label: fix.label })));
    else {
      const loading = document.createElement('p');
      loading.className = `${ROOT}-note`;
      loading.textContent = translate('ProofingSuggestionsLoading');
      chips.appendChild(loading);
    }

    const addWord = actionButton('common/book-plus', translate('ProofingAddToDictionary'));
    addWord.addEventListener('click', () => {
      resolveWord(issue.text, client.addPersonalWord(issue.text, options.language()));
    });

    const ignore = actionButton('common/eye-off', translate('ProofingIgnoreInNote'));
    ignore.addEventListener('click', () => {
      resolveWord(issue.text, client.addNoteIgnore(noteId, issue.text));
    });

    const actions = document.createElement('div');
    actions.className = `${ROOT}-actions`;
    actions.append(addWord, ignore);

    card.append(heading, word, message, chips, actions);
    document.body.appendChild(card);

    dom = card;
    openIssue = issue;
    focusScope = openTransientFocus(view);
    placeAt(card, anchor);
    dispatchProofing(view, { type: 'open', openId: issueIdOf(issue) });

    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);

    requestId += 1;
    const token = requestId;
    void client
      .suggest({
        language: options.language(),
        text: issue.segmentText,
        start: issue.segmentStart,
        end: issue.segmentEnd,
        ruleId: issue.ruleId,
      })
      .then((answer) => {
        if (token !== requestId || !dom) return;
        chipsInto(chips, [...fixes.map((fix) => ({ replacement: fix.replacement, label: fix.label })), ...answer.suggestions]);
        placeAt(card, anchor);
      })
      .catch(() => {
        if (token !== requestId || !dom) return;
        chipsInto(chips, fixes.map((fix) => ({ replacement: fix.replacement, label: fix.label })));
      });
  }

  return {
    openFor,
    contains,
    close,
    destroy(): void {
      close();
    },
  };
}
