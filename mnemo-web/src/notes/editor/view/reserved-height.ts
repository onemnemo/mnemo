/**
 * Reserves a height on every top-level block, the `contain-intrinsic-size` that
 * lets the engine skip laying out an off-screen `content-visibility: auto` block
 * without collapsing it. The number is each module's DOM-free estimate; `auto`
 * lets the engine replace it with the real size once the block has rendered.
 *
 * It lives on the node view rather than in a node decoration because ProseMirror
 * maps top-level node decorations as one flat list, so one per block would make
 * every keystroke cost the square of the note's length. The element is only
 * written while it is detached or inside ProseMirror's own update, where its
 * mutation observer is paused; a write anywhere else reads as an external edit.
 */

import { DOMSerializer, type DOMOutputSpec, type Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import type { BlockRegistry } from '../registry/build';
import type { EstimateContext } from '../registry/types';

/**
 * The width the estimators measure against, matching the note column the page
 * lays out (`max-w-[760px]` less its horizontal padding). A constant on purpose:
 * measuring would touch the DOM and re-estimate everything on resize, to refine a
 * guess the engine drops once the block has rendered.
 */
export const NOTE_CONTENT_WIDTH = 680;

/**
 * `renderSpec` as ProseMirror calls it for a plain node. The untyped last argument
 * makes it refuse a spec that splices an array out of the node's own attrs, the
 * guard against attribute content turning into markup.
 */
const renderNodeSpec = DOMSerializer.renderSpec as (
  doc: Document,
  structure: DOMOutputSpec,
  xmlNS: string | null,
  blockArraysIn: Record<string, unknown>,
) => { dom: Node; contentDOM?: HTMLElement };

/** A recursive estimator over the registry; a container's height is its children's. */
export function heightEstimator(registry: BlockRegistry, availableWidth: number): (node: PMNode) => number {
  const context: EstimateContext = {
    availableWidth,
    estimateChild: (node) => estimate(node),
  };
  function estimate(node: PMNode): number {
    const estimator = registry.estimators.get(node.type.name);
    if (!estimator) return 0;
    return Math.round(estimator(node, context));
  }
  return estimate;
}

/**
 * Writes `height` unless it is what the element already carries, and returns what
 * the element now carries. Zero removes the property, leaving the stylesheet's
 * fallback, since reserving nothing would collapse the block.
 *
 * The plain length goes first so an engine that rejects `auto <length>` keeps it.
 */
export function writeReservedHeight(dom: HTMLElement, height: number, written: number): number {
  if (height === written) return written;
  if (height > 0) {
    dom.style.setProperty('contain-intrinsic-size', `${String(height)}px`);
    dom.style.setProperty('contain-intrinsic-size', `auto ${String(height)}px`);
  } else {
    dom.style.removeProperty('contain-intrinsic-size');
  }
  return height;
}

/** The node types some other node names in its content expression. */
function namedInContent(registry: BlockRegistry): Set<string> {
  const named = new Set<string>();
  for (const spec of Object.values(registry.nodeSpecs)) {
    for (const token of spec.content?.match(/\w+/g) ?? []) {
      if (token in registry.nodeSpecs) named.add(token);
    }
  }
  return named;
}

export interface ReservedHeight {
  /** Re-estimates for a node the view was just updated to. */
  update(node: PMNode): void;
}

export interface HeightReserver {
  /** Whether blocks of this type are sized at all. */
  sizes(nodeName: string): boolean;
  /**
   * Starts sizing `dom` for `node`, or returns null when the node is nested. A
   * view never changes parent, so the answer holds for its lifetime.
   */
  track(view: EditorView, node: PMNode, dom: HTMLElement): ReservedHeight | null;
  /**
   * Thin views for the sized types that render through `toDOM` and can stand at
   * the top level. A type another node names in its content expression (a column
   * lane, a table row or cell) only ever appears nested, so it keeps ProseMirror's
   * own rendering.
   */
  proseViews(skip: ReadonlySet<string>): Record<string, NodeViewConstructor>;
}

export function createHeightReserver(
  registry: BlockRegistry,
  availableWidth: number = NOTE_CONTENT_WIDTH,
): HeightReserver {
  const estimate = heightEstimator(registry, availableWidth);
  // Keyed by document so a stale set is never consulted. `doc.resolve` would be the
  // obvious test, but it scans the children linearly and runs once per block on open.
  const topLevelByDoc = new WeakMap<PMNode, Set<PMNode>>();

  function isTopLevel(view: EditorView, node: PMNode): boolean {
    const doc = view.state.doc;
    let children = topLevelByDoc.get(doc);
    if (!children) {
      const built = new Set<PMNode>();
      doc.forEach((child) => built.add(child));
      topLevelByDoc.set(doc, built);
      children = built;
    }
    return children.has(node);
  }

  function track(view: EditorView, node: PMNode, dom: HTMLElement): ReservedHeight | null {
    if (!isTopLevel(view, node)) return null;
    let current = node;
    let written = writeReservedHeight(dom, estimate(node), 0);
    return {
      update(next) {
        if (next === current) return;
        current = next;
        written = writeReservedHeight(dom, estimate(next), written);
      },
    };
  }

  function proseView(type: string): NodeViewConstructor {
    return (node, view) => {
      const toDOM = node.type.spec.toDOM;
      if (!toDOM) throw new Error(`${type} has no toDOM to render`);
      const rendered = renderNodeSpec(document, toDOM(node), null, node.attrs);
      const dom = rendered.dom as HTMLElement;
      const height = track(view, node, dom);
      let current = node;
      const nodeView: NodeView = {
        dom,
        contentDOM: rendered.contentDOM ?? null,
        // The rule ProseMirror applies to a plain `toDOM` node: anything but new content rebuilds.
        update(next) {
          if (!next.sameMarkup(current)) return false;
          current = next;
          height?.update(next);
          return true;
        },
      };
      return nodeView;
    };
  }

  return {
    sizes: (nodeName) => registry.estimators.has(nodeName),
    track,
    proseViews(skip) {
      const nestedOnly = namedInContent(registry);
      const views: Record<string, NodeViewConstructor> = {};
      for (const name of registry.estimators.keys()) {
        if (skip.has(name) || nestedOnly.has(name) || !registry.nodeSpecs[name]?.toDOM) continue;
        views[name] = proseView(name);
      }
      return views;
    },
  };
}
