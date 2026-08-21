/**
 * The callout's NodeView: a real, pressable glyph in front of the callout's text.
 *
 * Not a CSS pseudo-element fed from the `data-callout-emoji` attr: a pseudo-element
 * receives no events of its own and can carry no name, so changing a glyph would need a
 * separate button in the block gutter pointing at something the reader cannot press. Here
 * the glyph is the control: press it and the emoji picker opens on it.
 *
 * The button lives outside `contentDOM`, carries `contenteditable="false"`, and
 * `ignoreMutation` owns every mutation inside it, so the caret has nowhere to
 * fall and the attribute sync on a glyph change cannot read as an external edit.
 * `update` writes the glyph in place, which is what keeps the picker anchored to
 * the same element across a pick.
 *
 * The node's `toDOM` and `parseDOM` are deliberately untouched: what a copy
 * writes and what a paste reads stay the shape every older build produced.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';
import {
  calloutIconRequest,
  closeCalloutIcon,
  openCalloutIcon,
  type CalloutIconRequest,
} from '../chrome/callout-icon-request';

/** Reads the active bundle at call time, so the glyph follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

/** Matches the node's own default, so a callout that arrives without one still tints. */
const defaultTone = 'note';

export function calloutView(
  args: RealizedBlockViewArgs<Record<string, unknown>>,
): RealizedBlockView {
  const { view } = args;

  const dom = document.createElement('aside');
  dom.setAttribute('data-callout', '');

  const glyph = document.createElement('button');
  glyph.type = 'button';
  glyph.className = 'notes-callout-glyph';
  glyph.setAttribute('contenteditable', 'false');
  glyph.setAttribute('aria-label', translate('CalloutIcon'));
  // The editable surface is the tab stop; the glyph is a pointer affordance, and
  // keyboard users reach the same verb through the block menu.
  glyph.tabIndex = -1;

  const body = document.createElement('div');
  body.className = 'notes-callout-body';
  dom.append(glyph, body);

  const sync = (node: PMNode): void => {
    const emoji = String(node.attrs.emoji ?? '');
    dom.setAttribute('data-callout-tone', String(node.attrs.tone ?? defaultTone) || defaultTone);
    dom.setAttribute('data-callout-emoji', emoji);
    glyph.textContent = emoji;
    // A cleared glyph draws no glyph column at all, the way it always has. The
    // block menu's row is what puts one back.
    glyph.hidden = emoji.length === 0;
  };
  sync(args.node);

  /** The block as it is now, at the live position, not the one captured at build. */
  const target = (): { pos: number; sid: string } | null => {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== args.node.type) return null;
    return { pos, sid: String(node.attrs.sid ?? '') };
  };

  // What the picker was up for when the press started. Read here, in the target
  // phase, because the picker's own document listener dismisses it during the
  // same gesture: without the earlier reading the click would reopen the picker
  // it had just closed.
  let openAtPress: CalloutIconRequest | null = null;
  const onPointerDown = (): void => {
    openAtPress = calloutIconRequest();
  };
  // A press inside the editor places the caret before the click lands, so the
  // glyph swallows the default the same way the checklist's box does.
  const onMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
  };
  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    // The read-only mount renders the same views; it must not offer an edit the
    // autosave cannot persist.
    if (!view.editable) return;
    const at = target();
    if (!at) return;
    // A second press on the glyph that already holds the picker puts it away; a
    // press on another callout's glyph moves the picker to that one.
    if (openAtPress?.sid === at.sid) {
      closeCalloutIcon();
      return;
    }
    openCalloutIcon(at);
  };
  glyph.addEventListener('pointerdown', onPointerDown);
  glyph.addEventListener('mousedown', onMouseDown);
  glyph.addEventListener('click', onClick);

  return {
    dom,
    contentDOM: body,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      sync(node);
      return true;
    },
    ignoreMutation(mutation) {
      if (mutation.type === 'selection') return false;
      // The sync writes attributes on the aside; everything inside the button is
      // this view's chrome. Content mutations reach the editor.
      return (
        (mutation.type === 'attributes' && mutation.target === dom) ||
        glyph.contains(mutation.target)
      );
    },
    destroy() {
      glyph.removeEventListener('pointerdown', onPointerDown);
      glyph.removeEventListener('mousedown', onMouseDown);
      glyph.removeEventListener('click', onClick);
    },
  };
}
