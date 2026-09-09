/**
 * The small card under a link that says where it goes and offers its common
 * actions.
 *
 * A link in an editable note is unreachable without one. The browser refuses to
 * follow a link inside a `contenteditable`, which is the protection the whole
 * editor relies on, so clicking one places the caret and does nothing else, and
 * nothing on screen even says what the address is. The same note read in the
 * side panel opens its links, which is exactly backwards from what a reader
 * expects.
 *
 * Body-level and viewport-positioned, the idiom the link flyout and the
 * proofing card already use here: mounted outside ProseMirror's content so its
 * own DOM is never read back as document corruption.
 *
 * It never takes focus. A click on a link is first of all a click into that
 * text, the same reading the proofing card takes of a click on a marked word,
 * so the caret stays where the press put it and the card is something to point
 * at rather than something to be in.
 */

import { getIconMarkup } from '@/components/icon/icon-registry';
import { useI18nStore } from '@/i18n/store';
import { createTranslate } from '@/i18n/translate';
import { placeCard, type Rect } from '../floating/position';

const ROOT = 'notes-link-chip';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/**
 * The schemes the host will actually launch. `isSafeUrl` is a wider gate: it
 * lets `mailto` and `tel` through as safe to render, and there is nothing to
 * hand those to, so Open says so rather than doing nothing when pressed.
 */
const OPENABLE_SCHEME = /^https?:/i;

export function canOpenExternally(href: string): boolean {
  return OPENABLE_SCHEME.test(href.trim());
}

export interface LinkChipActions {
  open(href: string): void;
  edit(href: string): void;
  copy(href: string): Promise<boolean>;
  hoverChanged(inside: boolean): void;
}

export interface LinkChipHandle {
  /** Draws the card for `href`, under `anchor`. Replaces one already showing. */
  show(href: string, anchor: Rect): void;
  hide(): void;
  isOpen(): boolean;
  /** Whether `node` is part of the card, so an outside-press handler can ignore it. */
  contains(node: Node): boolean;
  /** Re-places the card against a fresh anchor, for a scroll that kept it in view. */
  reposition(anchor: Rect): void;
  destroy(): void;
}

function actionButton(icon: string, label: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${ROOT}-action`;
  button.title = label;
  button.setAttribute('aria-label', label);
  const markup = getIconMarkup(icon);
  if (markup) button.innerHTML = markup;
  button.addEventListener('click', run);
  return button;
}

export function createLinkChip(actions: LinkChipActions): LinkChipHandle {
  let dom: HTMLElement | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  function hide(): void {
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = null;
    dom?.remove();
    dom = null;
  }

  async function copyHref(href: string, button: HTMLButtonElement): Promise<void> {
    if (!(await actions.copy(href)) || !button.isConnected) return;
    button.classList.add('is-copied');
    button.title = translate('LinkCopied');
    button.setAttribute('aria-label', button.title);
    const check = getIconMarkup('common/check');
    if (check) button.innerHTML = check;
    copiedTimer = setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove('is-copied');
      button.title = translate('LinkCopy');
      button.setAttribute('aria-label', button.title);
      const copy = getIconMarkup('common/copy');
      if (copy) button.innerHTML = copy;
      copiedTimer = null;
    }, 1400);
  }

  function build(href: string): HTMLElement {
    const card = document.createElement('div');
    card.className = `${ROOT} animate-pop-in`;
    // Never let ProseMirror treat this card's own DOM as document content.
    card.setAttribute('contenteditable', 'false');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', translate('LinkActionsLabel'));
    card.addEventListener('pointerenter', () => actions.hoverChanged(true));
    card.addEventListener('pointerleave', () => actions.hoverChanged(false));
    // The card is a place to point at, not to type in; a press on it must not
    // take the caret out of the text the link is in.
    card.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    const destination = actionButton('common/globe', translate('LinkOpen'), () => actions.open(href));
    destination.classList.add(`${ROOT}-destination`);
    destination.disabled = !canOpenExternally(href);
    const address = document.createElement('span');
    address.className = `${ROOT}-href`;
    address.textContent = href;
    destination.appendChild(address);

    const copy = actionButton('common/copy', translate('LinkCopy'), () => {
      void copyHref(href, copy);
    });

    const edit = actionButton('common/pencil', translate('EditLinkTitle'), () => actions.edit(href));
    edit.classList.add(`${ROOT}-edit`);
    const editText = document.createElement('span');
    editText.textContent = translate('LinkEditAction');
    edit.appendChild(editText);

    card.append(destination, copy, edit);
    return card;
  }

  function place(anchor: Rect): void {
    if (!dom) return;
    const size = { width: dom.offsetWidth, height: dom.offsetHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const { top, left } = placeCard(anchor, size, viewport);
    dom.style.top = `${String(top)}px`;
    dom.style.left = `${String(left)}px`;
  }

  return {
    show(href, anchor): void {
      hide();
      dom = build(href);
      document.body.appendChild(dom);
      place(anchor);
    },
    hide,
    isOpen: () => dom !== null,
    contains: (node) => dom?.contains(node) ?? false,
    reposition: place,
    destroy: hide,
  };
}
