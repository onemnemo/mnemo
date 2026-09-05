/**
 * The three ways a marked word is asked about.
 *
 * A left click on the mark, a right click on it with nothing selected, and
 * Alt+Enter with the caret inside one. The right click is shared with the
 * editor's context menu, which declines exactly where `markForRightClick`
 * answers, so one press produces a card or a menu and never both. A selection
 * is what tips it the other way: the reader has a range in hand and the verbs
 * for it are what the press is asking for.
 *
 * Alt+Enter is bound on the DOM rather than in a keymap so this stays out of
 * the plugin stack's precedence entirely. ProseMirror's own handler is
 * registered on `view.dom` when the view is built, which is before this, so any
 * keymap that claims the chord first has already marked the event handled and
 * this declines. It also declines when the caret is not inside a mark, so the
 * chord is free for anything else everywhere it does not apply.
 */

import type { EditorView } from 'prosemirror-view';
import type { Rect } from '../editor/floating/position';
import type { ProofingCardTrigger } from './issue-card';
import { issueAt, type LocatedIssue } from './proofing-plugin';

/** The mark under an event target, and the box to hang a card off. */
export function markUnder(view: EditorView, target: EventTarget | null): { located: LocatedIssue; rect: Rect } | null {
  if (!(target instanceof HTMLElement)) return null;
  const mark = target.closest('.proof-mark');
  if (!(mark instanceof HTMLElement)) return null;
  const located = issueAt(view.state, view.posAtDOM(mark, 0));
  return located ? { located, rect: mark.getBoundingClientRect() } : null;
}

/**
 * The mark a right click is the card's to answer, or null when the menu takes it.
 *
 * Asked on the press rather than on the contextmenu event, and of the press
 * target rather than of the selection: Chromium moves the caret into the word
 * on the mousedown that precedes the menu, so by then every right click on a
 * mark looks like a caret inside one. The editor's context menu asks this same
 * question on the same press and stays shut whenever it answers.
 */
export function markForRightClick(
  view: EditorView,
  target: EventTarget | null,
): { located: LocatedIssue; rect: Rect } | null {
  if (!view.state.selection.empty) return null;
  return markUnder(view, target);
}

/**
 * The mark the caret is in, and the box to hang a card off.
 *
 * The box comes from the rendered mark where there is one, so the chord and a
 * click put the card in the same place, and from the editor's own box when
 * there is not. Never from nothing: a card that refuses to open because a
 * measurement failed is a feature the keyboard cannot reach.
 */
export function markAtCaret(view: EditorView): { located: LocatedIssue; rect: Rect } | null {
  const located = issueAt(view.state, view.state.selection.from);
  if (!located) return null;

  const at = view.domAtPos(located.from + 1);
  const element = at.node instanceof HTMLElement ? at.node : at.node.parentElement;
  const mark = element?.closest('.proof-mark');
  if (mark instanceof HTMLElement) return { located, rect: mark.getBoundingClientRect() };
  return { located, rect: view.dom.getBoundingClientRect() };
}

function isOpenChord(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export interface CardTriggerOptions {
  open(hit: { located: LocatedIssue; rect: Rect; trigger: ProofingCardTrigger }): void;
  /** Whether a card is already up, so a second trigger does not stack one. */
  isOpen(): boolean;
}

/** Wires both triggers to a view and hands back the way to unwire them. */
export function installCardTriggers(view: EditorView, options: CardTriggerOptions): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || options.isOpen()) return;
    const hit = markUnder(view, event.target);
    // A click on a marked word is first of all a click into that word, so the
    // card that opens must not take the caret out of the document.
    if (hit) options.open({ ...hit, trigger: 'pointer' });
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 2 || options.isOpen()) return;
    const hit = markForRightClick(view, event.target);
    if (hit) options.open({ ...hit, trigger: 'pointer' });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Anything ahead of this on the same node has already had its say; a chord
    // it claimed is not this one's to reinterpret.
    if (event.defaultPrevented || !isOpenChord(event) || options.isOpen()) return;
    const hit = markAtCaret(view);
    if (!hit) return;
    event.preventDefault();
    options.open({ ...hit, trigger: 'keyboard' });
  };

  view.dom.addEventListener('click', onClick);
  view.dom.addEventListener('pointerdown', onPointerDown);
  view.dom.addEventListener('keydown', onKeyDown);
  return () => {
    view.dom.removeEventListener('click', onClick);
    view.dom.removeEventListener('pointerdown', onPointerDown);
    view.dom.removeEventListener('keydown', onKeyDown);
  };
}
