/**
 * The one link flyout each view owns, findable from outside the toolbar that
 * builds it.
 *
 * The flyout belongs to the formatting toolbar's plugin view, which is where
 * its two original entry points live (the Link button and the chord). The link
 * chip is a third, and it must reach the same instance rather than build one of
 * its own: two flyouts over one note would be two address fields disagreeing
 * about what the link is.
 *
 * Keyed by view because the flyout is a property of the view, not of the
 * plugin: one plugin instance can be reached from more than one view.
 */

import type { EditorView } from 'prosemirror-view';
import type { LinkPopoverHandle } from './link-popover';

const popovers = new WeakMap<EditorView, LinkPopoverHandle>();

export function registerLinkPopover(view: EditorView, handle: LinkPopoverHandle): void {
  popovers.set(view, handle);
}

export function unregisterLinkPopover(view: EditorView): void {
  popovers.delete(view);
}

/** The flyout for this view, or null when the toolbar plugin is not in its stack. */
export function linkPopoverFor(view: EditorView): LinkPopoverHandle | null {
  return popovers.get(view) ?? null;
}
