/**
 * The page reference's renderer: a card naming the note it points at, which
 * opens that note when it is clicked.
 *
 * This is the desktop's PageBlockComponent, a tinted document tile, the title
 * over an "Open page" subtitle, and a chevron on the right. Until now the block
 * rendered through its schema `toDOM`, an empty anchor, so a page reference took
 * up almost no room and said nothing at all.
 *
 * ## Three states, and they must not collapse into one
 *
 * The title is never stored in the block, that is `pageBlock`'s rule: copying it
 * in would mean a rename dirties every note linking to the renamed one. So it is
 * resolved on every build, and again whenever the note library changes.
 *
 * A title that will not resolve means one of three things and the card says
 * which. The library has not arrived yet, so nothing is known and the card waits.
 * The library arrived without the note, so the note is gone and the card says so
 * and stops offering to open it. Or the note is there with an empty title, which
 * is ordinary and reads as untitled. Without the subscription the first of those
 * would settle permanently on the second, telling the user a note they own has
 * been deleted.
 *
 * ## No `contentDOM`
 *
 * A page block carries a line like every block on the wire, but it renders
 * entirely from its `referenceNoteId` and its spans are force-cleared on the way
 * in. Handing ProseMirror a `contentDOM` would put an editable caret inside
 * content nothing reads back out, the same reason divider and block equation
 * omit it.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { getIconMarkup } from '@/components/icon/icon-registry';
import { navigate } from '@/app/router';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';

const ROOT = 'notes-page-card';

/** Reads the active bundle at call time, so the card follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function referenceOf(node: PMNode): string {
  return String(node.attrs.referenceNoteId ?? '');
}

function iconSpan(className: string, icon: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.innerHTML = getIconMarkup(icon) ?? '';
  return span;
}

export function pageBlockView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const { view, services } = args;

  const dom = document.createElement('a');
  dom.className = ROOT;
  // The node is not an atom in the schema, so without this the caret can be
  // dropped into the card, which is display output with no position to map back
  // to.
  dom.setAttribute('contenteditable', 'false');

  const text = document.createElement('span');
  text.className = `${ROOT}-text`;
  const title = document.createElement('span');
  title.className = `${ROOT}-title`;
  const subtitle = document.createElement('span');
  subtitle.className = `${ROOT}-subtitle`;
  text.append(title, subtitle);

  dom.append(iconSpan(`${ROOT}-tile`, 'common/file-text'), text, iconSpan(`${ROOT}-chevron`, 'common/chevron-right'));

  /** The node as it is now, at the live position, not the one captured at build. */
  function nodeAtPos(): PMNode | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? node : null;
  }

  function draw(node: PMNode): void {
    const reference = referenceOf(node);
    const resolved = reference.length > 0 ? services.resolveNoteTitle(reference) : undefined;
    // A supplier that cannot say whether its library has loaded is treated as
    // having loaded, which is what a harness with a fixed resolver means.
    const known = services.notes?.isLoaded() ?? true;
    const missing = reference.length === 0 || (known && resolved === undefined);

    if (missing) {
      dom.setAttribute('data-page-state', 'missing');
      dom.removeAttribute('href');
      title.textContent = translate('PageMissingTitle');
    } else if (resolved === undefined) {
      dom.setAttribute('data-page-state', 'resolving');
      dom.setAttribute('href', `#/notes/${reference}`);
      // Deliberately blank: a placeholder bar is drawn in its place. Guessing a
      // word here would put a title on screen that the next frame contradicts.
      title.textContent = '';
    } else {
      dom.setAttribute('data-page-state', 'ready');
      dom.setAttribute('href', `#/notes/${reference}`);
      // An untitled note is resolved, not missing. Only one of the two is
      // something to go and fix, so they must not read the same.
      title.textContent = resolved.trim() || translate('PageUntitled');
    }
    subtitle.textContent = translate('PageBlockOpenPage');
  }

  draw(args.node);

  function open(event: Event): void {
    const node = nodeAtPos() ?? args.node;
    const reference = referenceOf(node);
    // A card with nothing behind it is not a link; clicking it does nothing
    // rather than routing to a note id the app cannot resolve.
    if (reference.length === 0 || dom.getAttribute('data-page-state') === 'missing') return;
    // The browser will not follow a link inside a contenteditable, so the route
    // is set here. The href is still there for the status bar and for focus.
    event.preventDefault();
    navigate('notes', reference);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target !== dom) return;
    open(event);
  }

  dom.addEventListener('click', open);
  dom.addEventListener('keydown', onKeyDown);

  // The library arriving, and every later rename, redraws the card. Without it a
  // card built during the first fetch would claim its note had been deleted.
  const unsubscribe = services.notes?.subscribe(() => {
    draw(nodeAtPos() ?? args.node);
  });

  return {
    dom,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      draw(node);
      return true;
    },
    // No contentDOM: everything inside is chrome this view drew, and the
    // subscription redraws it outside a transaction. Selection records still
    // pass through.
    ignoreMutation(mutation) {
      return mutation.type !== 'selection';
    },
    destroy() {
      dom.removeEventListener('click', open);
      dom.removeEventListener('keydown', onKeyDown);
      unsubscribe?.();
    },
  };
}
