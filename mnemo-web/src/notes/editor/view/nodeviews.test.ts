// @vitest-environment jsdom

/**
 * The realized-view → NodeView adapter, tested against a synthetic registry so
 * the contract is exercised directly: the args the factory is handed, and the
 * NodeView shape handed back. The wiring through a real assembled registry is
 * covered where the mount renders an atom; here it is the adapter itself.
 */

import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry, RealizedViewFactory } from '../registry/build';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import { resolveServices, toNodeViews } from './nodeviews';

/** A registry that carries only what the adapter reads: the realized views map. */
function registryWith(views: Record<string, RealizedViewFactory>): BlockRegistry {
  return { realizedViews: new Map(Object.entries(views)) } as unknown as BlockRegistry;
}

const fakeView = {} as EditorView;
const fakeNode = { attrs: { sid: 's0001', latex: 'a' } } as unknown as PMNode;

describe('resolveServices', () => {
  it('defaults every resolver to "cannot resolve"', async () => {
    const services = resolveServices();
    expect(services.resolveNoteTitle('anything')).toBeUndefined();
    await expect(services.loadAssetUrl('anything')).rejects.toThrow();
    await expect(services.uploadAsset(new File(['x'], 'x.png'))).rejects.toThrow();
  });

  it('keeps the resolvers that were supplied', async () => {
    const services = resolveServices({ resolveNoteTitle: () => 'Title' });
    expect(services.resolveNoteTitle('id')).toBe('Title');
    // The unsupplied one still falls back rather than being dropped.
    await expect(services.loadAssetUrl('p')).rejects.toThrow();
  });
});

describe('toNodeViews', () => {
  it('produces one constructor per registered realized view', () => {
    const nodeViews = toNodeViews(
      registryWith({ a: () => ({ dom: document.createElement('div') }), b: () => ({ dom: document.createElement('div') }) }),
      resolveServices(),
    );
    expect(Object.keys(nodeViews).sort()).toEqual(['a', 'b']);
  });

  it('hands the factory the node, live getPos, attrs, a realized host and services', () => {
    let seen: RealizedBlockViewArgs<Record<string, unknown>> | undefined;
    const services = resolveServices({ resolveNoteTitle: () => 'T' });
    const nodeViews = toNodeViews(
      registryWith({
        widget: (args) => {
          seen = args;
          return { dom: document.createElement('span') };
        },
      }),
      services,
    );

    nodeViews.widget(fakeNode, fakeView, () => 5, [], null as never);

    expect(seen!.node).toBe(fakeNode);
    expect(seen!.attrs).toBe(fakeNode.attrs);
    expect(seen!.getPos()).toBe(5);
    expect(seen!.host.mode).toBe('realized');
    expect(seen!.services).toBe(services);
  });

  it('passes contentDOM straight through, present for editable blocks, null for atoms', () => {
    const content = document.createElement('div');
    const nodeViews = toNodeViews(
      registryWith({
        block: () => ({ dom: document.createElement('div'), contentDOM: content }),
        atom: () => ({ dom: document.createElement('span') }),
      }),
      resolveServices(),
    );

    const block = nodeViews.block(fakeNode, fakeView, () => 0, [], null as never);
    const atom = nodeViews.atom(fakeNode, fakeView, () => 0, [], null as never);
    expect(block.contentDOM).toBe(content);
    expect(atom.contentDOM).toBeNull();
  });

  it('forwards update and its return value', () => {
    const update = vi.fn<(node: PMNode) => boolean>().mockReturnValue(false);
    const nodeViews = toNodeViews(
      registryWith({ w: () => ({ dom: document.createElement('div'), update }) }),
      resolveServices(),
    );
    const nodeView = nodeViews.w(fakeNode, fakeView, () => 0, [], null as never);
    const next = { attrs: {} } as unknown as PMNode;

    expect(nodeView.update!(next, [], null as never)).toBe(false);
    expect(update).toHaveBeenCalledWith(next);
  });

  it('omits update when the view has none, so PM rebuilds rather than silently skipping', () => {
    const nodeViews = toNodeViews(
      registryWith({ w: () => ({ dom: document.createElement('div') }) }),
      resolveServices(),
    );
    const nodeView = nodeViews.w(fakeNode, fakeView, () => 0, [], null as never);
    expect(nodeView.update).toBeUndefined();
  });

  it('destroy reaches the realized view', () => {
    const destroy = vi.fn();
    const realized: RealizedBlockView = { dom: document.createElement('div'), destroy };
    const nodeViews = toNodeViews(
      registryWith({ w: () => realized }),
      resolveServices(),
    );
    const nodeView = nodeViews.w(fakeNode, fakeView, () => 0, [], null as never);
    nodeView.destroy!();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
