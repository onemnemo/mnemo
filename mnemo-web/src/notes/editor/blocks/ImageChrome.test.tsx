// @vitest-environment jsdom

/**
 * The pill on a picture: three alignments and everything else behind a kebab.
 *
 * No bundle is loaded in a test, so every label and every tooltip renders as its own translation
 * key. That is what the assertions read, so a wrong key fails here rather than shipping.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { resolveServices, toNodeViews } from '../view/nodeviews';
import { ImageChrome } from './ImageChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let view: EditorView | null = null;

function mount(align = 'left', options: { missingPos?: boolean } = {}) {
  const built = buildNoteEditState([
    block('Text', [span('before')]),
    block('Image', [span('')], { kind: 'image', path: 'a.png', alt: '', width: 0, align, crop: null }),
  ]);
  if (!built.ok) throw new Error('fixture did not build');

  const editorHost = document.createElement('div');
  document.body.appendChild(editorHost);
  view = new EditorView(editorHost, {
    state: built.state,
    nodeViews: toNodeViews(built.registry, resolveServices()),
  });

  const pos = view.state.doc.child(0).nodeSize;
  const onAlign = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <ImageChrome
        view={view!}
        registry={built.registry}
        services={resolveServices()}
        node={view!.state.doc.child(1)}
        getPos={() => (options.missingPos ? undefined : pos)}
        onAlign={onAlign}
      />,
    ),
  );
  return { host, onAlign };
}

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')];
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe('ImageChrome', () => {
  it('draws three alignments and a kebab, none of them a tab stop', () => {
    const { host } = mount();
    const labels = buttons(host).map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual([
      'ImageAlignLeftTooltip',
      'ImageAlignCenterTooltip',
      'ImageAlignRightTooltip',
      'ImageOptions',
    ]);
    expect(buttons(host).every((button) => button.tabIndex === -1)).toBe(true);
  });

  it('presses the alignment the picture already has, and asks for another on a click', () => {
    const { host, onAlign } = mount('center');
    const pressed = buttons(host).map((button) => button.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['false', 'true', 'false', null]);

    act(() => {
      buttons(host)[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAlign).toHaveBeenCalledWith('right');
  });

  it('opens the picture menu on the kebab, not the generic block one', () => {
    const { host } = mount();
    const kebab = buttons(host).at(-1)!;
    act(() => {
      kebab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      kebab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('ImageCropReposition');
    expect(text).toContain('ImageFlyoutCopyImage');
    expect(text).toContain('ImageFlyoutDelete');
    expect(text).not.toContain('TurnInto');
  });

  it('does not open an empty panel for a picture the document cannot locate', () => {
    const { host } = mount('left', { missingPos: true });
    const kebab = buttons(host).at(-1)!;
    act(() => {
      kebab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      kebab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(kebab.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
