/**
 * The one path every realized view reaches ProseMirror through.
 *
 * The registry hands out `RealizedViewFactory`s, the same `{ dom, contentDOM?,
 * update?, destroy? }` contract for blocks and atoms alike. ProseMirror wants a
 * `NodeViewConstructor` with a different signature (`node, view, getPos, …`) and
 * a different args shape. This adapts one to the other in a single place, so a
 * module never has to know ProseMirror's constructor shape and the editor never
 * has 17 near-identical wrappers.
 *
 * The factory needs a `host` and `services` the constructor does not carry. The
 * host is the shell lifecycle; until that builds real
 * shelling every block is permanently realized, so the host here is a stub that
 * only reports `realized` and refuses mode changes. `services` resolve note
 * titles and asset URLs, supplied by the mount, defaulted to "unknown" so a
 * missing resolver renders a blank rather than throwing.
 */

import type { EditorView, NodeViewConstructor } from 'prosemirror-view';
import type { BlockRegistry } from '../registry/build';
import type { BlockShellHost, EditorServices } from '../registry/types';

/**
 * A host that never shells. The shell lifecycle replaces this with one that drives the shelling
 * lifecycle; until then `requestMode` is a deliberate no-op, nothing yet asks
 * to shell, and a block that did would simply stay realized rather than break.
 */
function realizedHost(): BlockShellHost {
  return {
    mode: 'realized',
    requestMode() {},
    destroy() {},
  };
}

/** Resolvers default to "cannot resolve" rather than absent, so views need no null-guard branch. */
const noServices: EditorServices = {
  resolveNoteTitle: () => undefined,
  resolveAssetUrl: () => undefined,
};

export function resolveServices(partial?: Partial<EditorServices>): EditorServices {
  return { ...noServices, ...partial };
}

/**
 * Builds the `nodeViews` map ProseMirror is constructed with, one constructor
 * per registered realized view.
 *
 * Each constructor builds its host per instance (a shell lifecycle is per node,
 * not shared) and tears it down alongside the view. `contentDOM` is passed
 * through as-is: a block with editable inline content returns one and PM manages
 * what is inside it; an atom omits it and PM treats the whole `dom` as opaque.
 */
export function toNodeViews(
  registry: BlockRegistry,
  services: EditorServices,
): Record<string, NodeViewConstructor> {
  const nodeViews: Record<string, NodeViewConstructor> = {};

  for (const [nodeName, factory] of registry.realizedViews) {
    nodeViews[nodeName] = (node, view: EditorView, getPos) => {
      const host = realizedHost();
      const realized = factory({ node, view, getPos, attrs: node.attrs, host, services });

      return {
        dom: realized.dom,
        contentDOM: realized.contentDOM ?? null,
        // Bound through arrow functions so the realized view keeps its own
        // `this`, and only forwarded when it defines them, a NodeView that
        // declares `update`/`destroy` and then no-ops is not the same to PM as
        // one that omits them (omitting `update` forces a rebuild every time).
        update: realized.update ? (updated) => realized.update!(updated) : undefined,
        destroy: () => {
          realized.destroy?.();
          host.destroy();
        },
      };
    };
  }

  return nodeViews;
}
