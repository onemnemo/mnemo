/**
 * The portal registry store, and the primitive a React NodeView drives it by.
 *
 * The React component that renders these lives in `NodeViewPortal.tsx`; the
 * store is plain data and imperative lifecycle, so it sits here — a NodeView is
 * built in ProseMirror's world and reaches for `mountPortalNodeView` without
 * importing a component, and the store stays unit-testable without a render.
 *
 * Work is O(registered portals), never O(document): a flat map, and a snapshot
 * whose reference changes only on an actual mutation so a subscriber can skip a
 * render when nothing moved.
 */

import type { ReactNode } from 'react';

export interface PortalEntry {
  readonly key: string;
  readonly container: HTMLElement;
  readonly children: ReactNode;
}

export interface PortalRegistry {
  /** Adds (or replaces) the portal for `key` and schedules a render. */
  register(key: string, container: HTMLElement, children: ReactNode): void;
  /** Swaps only the rendered children for an already-registered `key`. */
  update(key: string, children: ReactNode): void;
  /** Removes the portal, unmounting its React subtree. */
  unregister(key: string): void;
  subscribe(listener: () => void): () => void;
  getEntries(): readonly PortalEntry[];
  /** Live portal count — the leak assertion in tests reads this. */
  readonly size: number;
}

export function createPortalRegistry(): PortalRegistry {
  const entries = new Map<string, PortalEntry>();
  const listeners = new Set<() => void>();
  // A stable reference is what `useSyncExternalStore` needs to skip a render
  // when nothing changed; it is replaced only on an actual mutation.
  let snapshot: readonly PortalEntry[] = [];

  function emit(): void {
    snapshot = [...entries.values()];
    for (const listener of listeners) listener();
  }

  return {
    register(key, container, children): void {
      entries.set(key, { key, container, children });
      emit();
    },
    update(key, children): void {
      const current = entries.get(key);
      // Silently ignore an update for a portal already gone: a NodeView update
      // racing its own destroy must not resurrect the entry.
      if (!current) return;
      entries.set(key, { ...current, children });
      emit();
    },
    unregister(key): void {
      if (entries.delete(key)) emit();
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getEntries(): readonly PortalEntry[] {
      return snapshot;
    },
    get size(): number {
      return entries.size;
    },
  };
}

let nextKey = 0;

/** The DOM container plus the imperative lifecycle a React NodeView drives it by. */
export interface PortalNodeView {
  /** The element to hand ProseMirror as the NodeView's `dom`. */
  readonly dom: HTMLElement;
  update(children: ReactNode): void;
  destroy(): void;
}

/**
 * Mounts a React child into a fresh container through the registry.
 *
 * This is the primitive a React realized view is built from, not a
 * `RealizedBlockView` itself: that contract's `update(node)` returns a boolean
 * and speaks ProseMirror nodes, so a React view wraps this — recompute children
 * from the node, call `update`, return true. Keeping the primitive separate is
 * what lets the same bridge serve a block body, a shell wrapper or a piece of
 * chrome without any of them knowing about the others.
 */
export function mountPortalNodeView(
  registry: PortalRegistry,
  children: ReactNode,
  options: { readonly tag?: keyof HTMLElementTagNameMap; readonly className?: string } = {},
): PortalNodeView {
  const key = `nv-${nextKey++}`;
  const container = document.createElement(options.tag ?? 'div');
  if (options.className) container.className = options.className;
  registry.register(key, container, children);

  return {
    dom: container,
    update(next): void {
      registry.update(key, next);
    },
    destroy(): void {
      registry.unregister(key);
    },
  };
}
