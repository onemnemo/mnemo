// @vitest-environment jsdom

/**
 * The portal bridge, at two layers: the registry store on its own (no React),
 * and the full render lifecycle through `<NodeViewPortals>`. The lifecycle
 * assertions are the point here — a registered React child renders
 * into its container, an update swaps it, and destroy unmounts it and leaves no
 * entry behind, across churn.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeViewPortals } from './NodeViewPortal';
import {
  createPortalRegistry,
  mountPortalNodeView,
  type PortalRegistry,
} from './portal-registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('portal registry store', () => {
  it('registers an entry and reports its size', () => {
    const registry = createPortalRegistry();
    const container = document.createElement('div');
    registry.register('k', container, 'hi');

    expect(registry.size).toBe(1);
    const [entry] = registry.getEntries();
    expect(entry.container).toBe(container);
    expect(entry.children).toBe('hi');
  });

  it('returns a stable snapshot until a mutation replaces it', () => {
    const registry = createPortalRegistry();
    const before = registry.getEntries();
    expect(registry.getEntries()).toBe(before);

    registry.register('k', document.createElement('div'), null);
    expect(registry.getEntries()).not.toBe(before);
  });

  it('notifies subscribers on change, and stops after unsubscribe', () => {
    const registry = createPortalRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.register('k', document.createElement('div'), null);
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    registry.unregister('k');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('does not emit for an unregister of an absent key', () => {
    const registry = createPortalRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.unregister('never-registered');
    expect(listener).not.toHaveBeenCalled();
  });

  it('an update for a removed key does not resurrect it', () => {
    const registry = createPortalRegistry();
    registry.register('k', document.createElement('div'), 'a');
    registry.unregister('k');
    registry.update('k', 'b');
    expect(registry.size).toBe(0);
  });
});

describe('NodeViewPortals lifecycle', () => {
  let container: HTMLElement;
  let root: Root;
  let registry: PortalRegistry;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    registry = createPortalRegistry();
    act(() => root.render(<NodeViewPortals registry={registry} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders a registered React child into its own container', () => {
    let view!: ReturnType<typeof mountPortalNodeView>;
    act(() => {
      view = mountPortalNodeView(registry, <span>hello</span>);
    });
    expect(view.dom.textContent).toBe('hello');
  });

  it('an update swaps the rendered content in place', () => {
    let view!: ReturnType<typeof mountPortalNodeView>;
    act(() => {
      view = mountPortalNodeView(registry, <span>first</span>);
    });
    act(() => view.update(<span>second</span>));
    expect(view.dom.textContent).toBe('second');
  });

  it('destroy unmounts the subtree and drops the entry', () => {
    let view!: ReturnType<typeof mountPortalNodeView>;
    act(() => {
      view = mountPortalNodeView(registry, <span>bye</span>);
    });
    expect(registry.size).toBe(1);

    act(() => view.destroy());
    expect(view.dom.textContent).toBe('');
    expect(registry.size).toBe(0);
  });

  it('renders many portals independently and releases every one', () => {
    const views: ReturnType<typeof mountPortalNodeView>[] = [];
    act(() => {
      for (let i = 0; i < 20; i++) views.push(mountPortalNodeView(registry, <span>{`p${i}`}</span>));
    });
    expect(registry.size).toBe(20);
    expect(views[7].dom.textContent).toBe('p7');

    act(() => {
      for (const view of views) view.destroy();
    });
    expect(registry.size).toBe(0);
  });

  it('survives repeated mount/destroy churn with no leaked entries', () => {
    act(() => {
      for (let i = 0; i < 50; i++) {
        const view = mountPortalNodeView(registry, <span>{`churn${i}`}</span>);
        view.destroy();
      }
    });
    expect(registry.size).toBe(0);
  });
});
