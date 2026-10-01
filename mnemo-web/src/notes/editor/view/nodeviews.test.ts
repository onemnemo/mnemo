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
import { buildNoteEditState } from '../../edit/build-edit-state';

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
    const registry = registryWith({
      widget: (args) => {
        seen = args;
        return { dom: document.createElement('span') };
      },
    });
    const nodeViews = toNodeViews(registry, services);

    nodeViews.widget(fakeNode, fakeView, () => 5, [], null as never);

    expect(seen!.node).toBe(fakeNode);
    expect(seen!.attrs).toBe(fakeNode.attrs);
    expect(seen!.getPos()).toBe(5);
    expect(seen!.host.mode).toBe('realized');
    expect(seen!.services).toMatchObject(services);
    // The registry rides along with the services, for a view whose body acts on its own block.
    expect(seen!.services.registry).toBe(registry);
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

describe('toNodeViews with reserved heights', () => {
  /** A sized realized view `w`, estimated from its node's `h` attr, sitting at the top of `doc`. */
  const nodeOfHeight = (h: number) => ({ attrs: { h }, type: { name: 'w' } }) as unknown as PMNode;

  function sized(update?: (node: PMNode) => boolean) {
    const node = nodeOfHeight(40);
    const registry = {
      realizedViews: new Map([['w', () => ({ dom: document.createElement('div'), update })]]),
      estimators: new Map([['w', (n: PMNode) => Number(n.attrs.h)]]),
      nodeSpecs: {},
    } as unknown as BlockRegistry;
    const view = { state: { doc: { forEach: (f: (child: PMNode) => void) => f(node) } }, composing: false };
    const nodeViews = toNodeViews(registry, resolveServices(), { reserveHeights: true });
    const nodeView = nodeViews.w(node, view as unknown as EditorView, () => 0, [], null as never);
    return { nodeView, view, height: () => (nodeView.dom as HTMLElement).style.getPropertyValue('contain-intrinsic-size') };
  }

  it('keeps the view shape: no update appears for a view without one', () => {
    expect(sized().nodeView.update).toBeUndefined();
  });

  it('re-reserves only when the realized view kept the update', () => {
    let keep = false;
    const { nodeView, height } = sized(() => keep);
    expect(height()).toBe('auto 40px');

    const taller = nodeOfHeight(90);
    expect(nodeView.update!(taller, [], null as never)).toBe(false);
    expect(height()).toBe('auto 40px');

    keep = true;
    expect(nodeView.update!(taller, [], null as never)).toBe(true);
    expect(height()).toBe('auto 90px');
  });

  it('restyles the composing block on the edit the composition itself makes', () => {
    // An IME's last edit arrives while the view is still composing, and the end of
    // the composition brings no new node, so that edit is the only chance to update.
    const { nodeView, view, height } = sized(() => true);
    view.composing = true;
    nodeView.update!(nodeOfHeight(90), [], null as never);
    expect(height()).toBe('auto 90px');
  });

  it('keeps ProseMirror rendering for types that only ever appear nested', () => {
    const built = buildNoteEditState([]);
    if (!built.ok) throw new Error('fixture did not build');
    const names = Object.keys(toNodeViews(built.registry, resolveServices(), { reserveHeights: true }));

    expect(names).toEqual(expect.arrayContaining(['paragraph', 'heading', 'quote', 'bulletItem', 'numberedItem', 'divider', 'sketch']));
    expect(names.filter((name) => ['columnGroup', 'tableRow', 'tableCell'].includes(name))).toEqual([]);
  });
});
