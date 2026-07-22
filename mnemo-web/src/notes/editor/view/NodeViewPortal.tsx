/**
 * The React↔ProseMirror portal bridge, the render half.
 *
 * ProseMirror owns the DOM; React owns component trees. A NodeView that wants to
 * render a React component cannot mount a second React root inside the editor,
 * dozens of roots is dozens of reconcilers, and a root nested in PM-managed DOM
 * is exactly the kind of foreign mutation PM's MutationObserver tears down and
 * rebuilds around. The bridge keeps one React tree: a NodeView creates a plain
 * DOM container and registers a React child to render *into* it (see
 * `portal-registry.ts`), and this component renders every registered child
 * through `createPortal`, so all of them reconcile inside the app's single root,
 * beside the editor rather than inside a private one.
 *
 * No current realized view is React, the atoms are plain DOM. This is the seam
 * the React block chrome and the shell host mount through; it ships
 * now, with its lifecycle proven, because its teardown budget matters as much as
 * the editor's.
 *
 * Nothing here walks the document. `getSnapshot` returns the same array
 * reference until a registration mutates it, so a portal that did not change
 * does not re-render.
 */

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import type { PortalRegistry } from './portal-registry';

/**
 * Renders every registered portal. Mount one of these in the app tree beside the
 * editor; it holds no state of its own beyond the subscription.
 */
export function NodeViewPortals({ registry }: { registry: PortalRegistry }): ReactNode {
  const entries = useSyncExternalStore(
    registry.subscribe,
    registry.getEntries,
    registry.getEntries,
  );
  return entries.map((entry) => createPortal(entry.children, entry.container, entry.key));
}
