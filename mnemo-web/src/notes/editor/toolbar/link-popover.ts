/**
 * The link editing flyout: inserts, retargets, renames or removes a link.
 *
 * A body-level, viewport-positioned card, the idiom `equation-editor.ts`
 * already established for this editor's floating chrome (a text field and a
 * Done button, mounted outside ProseMirror's content so its own DOM is never
 * read as document corruption), not the desktop's modal dialog. One working
 * "floating card" pattern already exists here; a second, differently-shaped
 * container for the same job would just be a second thing to keep looking
 * right, for no reachability gained.
 *
 * One popover per formatting-toolbar view, opened from two places that must
 * never disagree about what "edit the link" does:
 *
 *  - The toolbar's Link button, anchored to the button. Only reachable when
 *    there is a real selection, because that is when the toolbar itself is
 *    showing.
 *  - The `Mod-Shift-l` shortcut (desktop's `editor.link` chord), anchored to
 *    the caret. This is the only route to a link with a collapsed caret: the
 *    toolbar hides itself for an empty selection, so a caret parked inside an
 *    existing link needs a path that does not depend on the toolbar being
 *    visible at all.
 *
 * A single-block selection can edit both the destination and the words the
 * reader sees. A selection spanning blocks keeps its structure and edits only
 * the destination.
 */

import type { EditorView } from 'prosemirror-view';
import { getIconMarkup } from '../../../components/icon/icon-registry';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import { openTransientFocus, type TransientFocusScope } from '../focus';
import type { Rect } from '../floating/position';
import { applyLink, currentLinkContext, removeLink } from '../marks/link-commands';

const ROOT = 'notes-link-flyout';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/** Matches the equation flyout's commit label: the desktop's "Done ↵". */
function doneLabel(): string {
  return `${createTranslate(useI18nStore.getState().bundle)('Common', 'Done')} ↵`;
}

/**
 * Below the anchor, left-aligned to it, clamped into the viewport, flipped
 * above when there is no room below. The same placement `equation-editor.ts`
 * uses, taking a `Rect` rather than an element so one function serves both a
 * button's own rect and a bare caret coordinate.
 */
function placeAt(dom: HTMLElement, anchor: Rect): void {
  const width = dom.offsetWidth;
  const height = dom.offsetHeight;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8));
  dom.style.left = `${String(left)}px`;
  let top = anchor.bottom + 6;
  if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 6);
  dom.style.top = `${String(top)}px`;
}

interface Card {
  readonly dom: HTMLElement;
  readonly urlInput: HTMLInputElement;
  readonly textInput: HTMLInputElement | null;
  readonly done: HTMLButtonElement;
  readonly remove: HTMLButtonElement | null;
  readonly error: HTMLElement;
}

function field(labelText: string, input: HTMLInputElement): HTMLElement {
  const label = document.createElement('label');
  label.className = `${ROOT}-field`;
  const caption = document.createElement('span');
  caption.className = `${ROOT}-label`;
  caption.textContent = labelText;
  label.append(caption, input);
  return label;
}

function textInput(value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `${ROOT}-input`;
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocomplete = 'off';
  return input;
}

function buildCard(context: NonNullable<ReturnType<typeof currentLinkContext>>): Card {
  const dom = document.createElement('div');
  dom.className = ROOT;
  // Never let ProseMirror treat this card's own DOM as document content.
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('role', 'dialog');
  dom.setAttribute('aria-label', translate(context.hasLink ? 'EditLinkTitle' : 'InsertLinkTitle'));

  const urlInput = textInput(context.href, translate('InsertLinkUrlPlaceholder'));
  urlInput.inputMode = 'url';
  dom.appendChild(field(translate('InsertLinkUrlLabel'), urlInput));

  let displayInput: HTMLInputElement | null = null;
  if (context.canEditText) {
    displayInput = textInput(context.text, translate('InsertLinkDisplayPlaceholder'));
    dom.appendChild(field(translate('InsertLinkDisplayLabel'), displayInput));
  } else {
    const hint = document.createElement('p');
    hint.className = `${ROOT}-hint`;
    hint.textContent = translate('CrossBlockLinkHint');
    dom.appendChild(hint);
  }

  const actions = document.createElement('div');
  actions.className = `${ROOT}-actions`;

  const done = document.createElement('button');
  done.type = 'button';
  done.className = `${ROOT}-done`;
  done.textContent = doneLabel();

  let remove: HTMLButtonElement | null = null;
  if (context.hasLink) {
    remove = document.createElement('button');
    remove.type = 'button';
    remove.className = `${ROOT}-remove`;
    remove.setAttribute('aria-label', translate('InsertLinkRemoveLink'));
    const icon = getIconMarkup('formatting-toolbar/unlink');
    if (icon) remove.innerHTML = icon;
    const removeText = document.createElement('span');
    removeText.textContent = translate('InsertLinkRemoveLink');
    remove.appendChild(removeText);
    actions.appendChild(remove);
  }
  actions.appendChild(done);

  const error = document.createElement('div');
  error.className = `${ROOT}-error`;
  error.textContent = translate('LinkUrlRejected');
  error.hidden = true;

  dom.append(actions, error);
  document.body.appendChild(dom);

  return { dom, urlInput, textInput: displayInput, done, remove, error };
}

export interface LinkPopoverHandle {
  isOpen(): boolean;
  /** Whether `node` is part of the open card, so a document-level click handler can ignore it. */
  contains(node: Node): boolean;
  /**
   * Opens for `anchor` if nothing is open; a no-op while already open, so a
   * repeated chord cannot cancel an edit in progress. Returns whether it
   * opened, the shortcut's own "did this do anything" answer.
   */
  open(anchor: Rect, href?: string): boolean;
  /** Opens if closed, cancels and closes (refocusing the editor) if open: the toolbar button's click. */
  toggle(anchor: Rect): void;
  /**
   * Dismisses without forcing focus, for the toolbar's own outside-press
   * handling and for whenever it hides itself; a no-op while already closed.
   */
  close(): void;
  destroy(): void;
}

/**
 * One flyout per formatting-toolbar view. Reads `view.state` fresh at every
 * open rather than once at construction, so the href it seeds with and the
 * selection it applies to are always the live ones, the discipline the
 * equation NodeView's own popover follows.
 */
export function createLinkPopover(view: EditorView): LinkPopoverHandle {
  let card: Card | null = null;
  let focusScope: TransientFocusScope | null = null;

  function isOpen(): boolean {
    return card !== null;
  }

  function contains(node: Node): boolean {
    return card?.dom.contains(node) ?? false;
  }

  function showError(): void {
    if (card) card.error.hidden = false;
  }

  function teardown(): void {
    if (!card) return;
    card.dom.remove();
    card = null;
  }

  /**
   * Tears the card down, resolves the focus scope, and returns the caret to
   * the document. The path every resolution the popover itself drives ends
   * on: Escape, Enter, Done, Remove, and toggling the trigger button closed
   * again. All of those are the user finishing with the popover, the same
   * moment Escape resolves the equation flyout by refocusing the editor.
   */
  function settle(outcome: 'commit' | 'cancel'): void {
    const scope = focusScope;
    focusScope = null;
    teardown();
    if (outcome === 'commit') scope?.release();
    else scope?.restore();
    view.focus();
  }

  /**
   * Tears the card down and stands the focus scope down, but does not touch
   * DOM focus or the selection. For the one resolution that is not the user
   * finishing with the popover: a press elsewhere on the page, already
   * claiming focus for itself. `restore()` is not what this wants either,
   * its whole contract ends in an unconditional `view.focus()`, exactly the
   * theft this is trying to avoid. `release()` is the same call the
   * toolbar's own outside-press branch makes on its focus scope, for the
   * same reason: the popover never touched `state.selection` while it was
   * open, so there is nothing to put back, only a scope to stop holding.
   */
  function dismiss(): void {
    if (!card) return;
    const scope = focusScope;
    focusScope = null;
    teardown();
    scope?.release();
  }

  function commitApply(): void {
    if (!card) return;
    const href = card.urlInput.value.trim();
    if (href.length === 0) {
      // An emptied field on confirm removes an existing link, matching the
      // desktop; with nothing to remove it is the same as cancelling.
      if (card.remove) settle(removeLink()(view.state, view.dispatch) ? 'commit' : 'cancel');
      else settle('cancel');
      return;
    }
    if (!applyLink(href, card.textInput?.value)(view.state, view.dispatch)) {
      // Left open: the schema would refuse this href, so committing now
      // would silently drop it rather than apply it. `isSafeUrl` is the same
      // gate the mark's own `getAttrs`/`toDOM` enforce.
      showError();
      return;
    }
    settle('commit');
  }

  function commitRemove(): void {
    if (!card) return;
    settle(removeLink()(view.state, view.dispatch) ? 'commit' : 'cancel');
  }

  function cancel(): void {
    if (card) settle('cancel');
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitApply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }

  function open(anchor: Rect, href?: string): boolean {
    if (card) return false;
    const liveContext = currentLinkContext(view.state);
    if (!liveContext) return false;
    const context = href === undefined
      ? liveContext
      : { ...liveContext, href, hasLink: true };

    // Captured before this takes DOM focus, so Escape or an outside press can
    // put the selection back even if something else moved it while open.
    focusScope = openTransientFocus(view);
    const built = buildCard(context);
    card = built;
    placeAt(built.dom, anchor);

    built.urlInput.addEventListener('keydown', onKeydown);
    built.textInput?.addEventListener('keydown', onKeydown);
    built.urlInput.addEventListener('input', () => {
      built.error.hidden = true;
    });
    built.done.addEventListener('click', commitApply);
    built.remove?.addEventListener('click', commitRemove);

    built.urlInput.focus();
    built.urlInput.select();
    return true;
  }

  function toggle(anchor: Rect): void {
    if (card) cancel();
    else open(anchor);
  }

  function destroy(): void {
    teardown();
    // The view is going away with it; there is nothing left to restore into.
    focusScope = null;
  }

  return { isOpen, contains, open, toggle, close: dismiss, destroy };
}
