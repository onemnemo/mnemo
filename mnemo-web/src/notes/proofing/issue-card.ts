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
 *
 * Where the keyboard goes on open depends on how it was opened, and both
 * answers matter. A pointer open takes no focus at all: clicking into a
 * misspelled word to repair it by hand is the commonest thing anyone does with
 * a red underline, and the caret has to stay where it was put. A keyboard open
 * takes focus, but never onto an action that writes something: until the
 * suggestions arrive it sits on Close, and Enter does nothing at all, because
 * the alternative was a card whose first key press taught the dictionary the
 * misspelling. Once they land it moves to the first replacement, which is what
 * the card exists to offer.
 *
 * The arrows and Tab then move between the controls without leaving the card,
 * and every path that closes it puts the caret back, because the actions that
 * are not a replacement would otherwise leave the writer with no caret and a
 * page they have to click back into.
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
  type LocatedIssue,
  type ProofingIssue,
} from './proofing-plugin';
import type { ProofingSuggestion } from './types';

const ROOT = 'notes-proof-card';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function common(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('Common', key);
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

function titleFor(issue: ProofingIssue): string {
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
  /** The note's languages, read at open time so a settings change is picked up. */
  languages(): readonly string[];
  readonly noteId: string;
  /** Called after the word stops being checkable, so its other marks can go. */
  onWordResolved(word: string): void;
}

/** How the card was asked for, which decides whether it may take the keyboard. */
export type ProofingCardTrigger = 'pointer' | 'keyboard';

export interface ProofingCardHandle {
  openFor(located: LocatedIssue, anchor: Rect, trigger?: ProofingCardTrigger): void;
  contains(node: Node): boolean;
  isOpen(): boolean;
  /** Closes without touching focus, for a press that has already claimed it. */
  dismiss(): void;
  /** Closes and puts the caret back in the document. */
  cancel(): void;
  destroy(): void;
}

export function createProofingCard(options: ProofingCardOptions): ProofingCardHandle {
  const { view, client, noteId } = options;

  let dom: HTMLElement | null = null;
  let focusScope: TransientFocusScope | null = null;
  let openIssue: ProofingIssue | null = null;
  let requestId = 0;
  /** Suggestions are still on their way, so nothing on the card may be pressed. */
  let loading = false;
  let closeButton: HTMLButtonElement | null = null;
  let openTrigger: ProofingCardTrigger = 'pointer';

  function contains(node: Node): boolean {
    return dom?.contains(node) ?? false;
  }

  function isOpen(): boolean {
    return dom !== null;
  }

  /** The controls the arrows and Tab cycle through, in the order they read. */
  function controls(): HTMLButtonElement[] {
    return [...(dom?.querySelectorAll('button') ?? [])].filter(
      (element): element is HTMLButtonElement => element instanceof HTMLButtonElement,
    );
  }

  /**
   * Tears the card down. The scope's resolution is the caller's, because the
   * two answers are genuinely different: an action taken through the card
   * leaves the selection somewhere deliberate and stands the scope down, while
   * abandoning the card has to put the caret back where the writer left it.
   */
  function teardown(outcome: 'release' | 'restore'): void {
    if (!dom) return;
    requestId += 1;
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onEscape, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    dom.remove();
    dom = null;
    openIssue = null;
    loading = false;
    closeButton = null;
    const scope = focusScope;
    focusScope = null;
    if (!view.isDestroyed) dispatchProofing(view, { type: 'open', openId: null });
    if (outcome === 'restore' && !view.isDestroyed) scope?.restore();
    else scope?.release();
  }

  function dismiss(): void {
    teardown('release');
  }

  function cancel(): void {
    teardown('restore');
  }

  function onOutsidePointer(event: PointerEvent): void {
    if (event.target instanceof Node && contains(event.target)) return;
    // The press has already chosen where focus goes; restoring would take it
    // straight back off whatever the writer just clicked.
    dismiss();
  }

  function onScroll(): void {
    cancel();
  }

  function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !dom) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }

  /** Arrows move between the controls; Tab cycles inside the card rather than out of it. */
  function onCardKeydown(event: KeyboardEvent): void {
    // Nothing on the card is worth pressing before its suggestions exist, and
    // the alternative to swallowing this is a first Enter that writes to the
    // personal dictionary.
    if (loading && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return;
    }

    const buttons = controls();
    if (buttons.length === 0) return;
    const at = buttons.findIndex((button) => button === document.activeElement);

    let step = 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') step = 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') step = -1;
    else if (event.key === 'Tab') step = event.shiftKey ? -1 : 1;
    else return;

    event.preventDefault();
    const from = at < 0 ? (step > 0 ? -1 : 0) : at;
    buttons[(from + step + buttons.length) % buttons.length].focus();
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
    // The write puts the caret at the repaired word, so there is nothing to
    // restore; `view.focus()` below is the whole of the focus story.
    teardown('release');
    if (!issue) return;
    const live = currentIssue(view.state, issue);
    if (!live) return;
    if (view.state.doc.textBetween(live.from, live.to) !== issue.text) return;

    // One past the start, so the marks come from the text node the word is
    // actually in. At the start itself a resolved position answers with the
    // marks of the node *before* it, which turns a plain word after a bold run
    // bold and strips the italic off a word that follows an atom.
    const marks = view.state.doc.resolve(live.from + 1).marks();
    const tr = view.state.tr;
    if (replacement.length === 0) tr.delete(live.from, live.to);
    else tr.replaceWith(live.from, live.to, view.state.schema.text(replacement, marks));
    view.dispatch(asOwnUndoStep(tr));
    view.focus();
  }

  function resolveWord(word: string, work: Promise<unknown>): void {
    // The word stays where it is and the caret belongs back in it.
    teardown('restore');
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

  /** The first replacement, which is the only control worth opening on. */
  function firstChip(): HTMLButtonElement | null {
    const chip = dom?.querySelector(`.${ROOT}-chip`);
    return chip instanceof HTMLButtonElement ? chip : null;
  }

  /**
   * Where a keyboard open puts focus: a replacement if there is one, and Close
   * otherwise. Never an action that writes, because the first key press after
   * the card appears must not be able to change anything.
   */
  function focusOnOpen(): void {
    (firstChip() ?? closeButton ?? dom)?.focus();
  }

/**
   * Focus once the chips are rebuilt. A card the pointer opened never takes it,
   * whatever arrives; a card the keyboard opened takes it only if the writer
   * has not already chosen a control for themselves, which is exactly the case
   * where focus is still parked on Close waiting for this.
   */
  function settleFocus(held: Element | null): void {
    if (!dom || openTrigger !== 'keyboard') return;
    if (dom.contains(held) && held !== closeButton) return;
    focusOnOpen();
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

  function openFor(located: LocatedIssue, anchor: Rect, trigger: ProofingCardTrigger = 'pointer'): void {
    if (dom) cancel();
    const issue = located.issue;

    const card = document.createElement('div');
    card.className = ROOT;
    // Never let ProseMirror read this card's own DOM as document content.
    card.setAttribute('contenteditable', 'false');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.tabIndex = -1;
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
    const fixes = (issue.fixes ?? []).map((fix) => ({ replacement: fix.replacement, label: fix.label }));
    loading = fixes.length === 0;
    if (fixes.length > 0) chipsInto(chips, fixes);
    else {
      const pending = document.createElement('p');
      pending.className = `${ROOT}-note`;
      pending.textContent = translate('ProofingSuggestionsLoading');
      chips.appendChild(pending);
    }

    const addWord = actionButton('common/book-plus', translate('ProofingAddToDictionary'));
    addWord.addEventListener('click', () => {
      // Unscoped: from here the answer is "this is a word", not "this is a word
      // in whichever dictionary happened to flag it", and a note checked in two
      // languages has no single one to attribute it to anyway.
      resolveWord(issue.text, client.addPersonalWord(issue.text, null));
    });

    const ignore = actionButton('common/eye-off', translate('ProofingIgnoreInNote'));
    ignore.addEventListener('click', () => {
      resolveWord(issue.text, client.addNoteIgnore(noteId, issue.text));
    });

    const close = actionButton('common/x', common('Close'));
    close.addEventListener('click', () => {
      cancel();
    });
    closeButton = close;

    const actions = document.createElement('div');
    actions.className = `${ROOT}-actions`;
    actions.append(addWord, ignore, close);

    card.append(heading, word, message, chips, actions);
    card.addEventListener('keydown', onCardKeydown);
    document.body.appendChild(card);

    dom = card;
    openIssue = issue;
    openTrigger = trigger;
    focusScope = openTransientFocus(view);
    placeAt(card, anchor);
    dispatchProofing(view, { type: 'open', openId: issueIdOf(issue) });

    document.addEventListener('pointerdown', onOutsidePointer, true);
    document.addEventListener('keydown', onEscape, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    // A pointer open leaves the caret alone: the click that opened this card is
    // the same gesture that puts the caret in the word being repaired.
    if (trigger === 'keyboard') focusOnOpen();

    requestId += 1;
    const token = requestId;
    void client
      .suggest({
        languages: options.languages(),
        noteId,
        text: issue.segmentText,
        start: issue.segmentStart,
        end: issue.segmentEnd,
        ruleId: issue.ruleId,
      })
      .then((answer) => {
        if (token !== requestId || !dom) return;
        const held = document.activeElement;
        chipsInto(chips, [...fixes, ...answer.suggestions]);
        loading = false;
        placeAt(card, anchor);
        settleFocus(held);
      })
      .catch(() => {
        if (token !== requestId || !dom) return;
        const held = document.activeElement;
        chipsInto(chips, fixes);
        loading = false;
        settleFocus(held);
      });
  }

  return {
    openFor,
    contains,
    isOpen,
    dismiss,
    cancel,
    destroy(): void {
      teardown('release');
    },
  };
}
