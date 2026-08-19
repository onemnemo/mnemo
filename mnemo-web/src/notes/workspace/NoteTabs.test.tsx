// @vitest-environment jsdom

/**
 * Keyboard reachability for the tab strip. Before this, a tab's whole switch
 * surface was a `<div onClick>` with no `tabIndex` and no `onKeyDown`, so a
 * keyboard user could reach the close button on a tab but never the tab
 * itself: Tab skipped straight over it. Checked here rather than left to a
 * visual read, since a missing tab stop leaves nothing on screen to notice.
 *
 * The harness re-renders on every select, the way the real workspace does by
 * feeding `activeId` back from its own state, so the roving tabindex is
 * checked across an actual update and not just at a single fixed render.
 */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoteTabs, type NoteTab } from './NoteTabs';

vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: readonly NoteTab[] = [
  { id: 'a', title: 'Anatomy', emoji: null },
  { id: 'b', title: 'Biology', emoji: null },
  { id: 'c', title: 'Chemistry', emoji: null },
];

let container: HTMLElement;
let root: Root;
let selected: string[];
let closed: string[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  selected = [];
  closed = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** A minimal stand-in for the workspace: owns `activeId`, feeds it straight back in. */
function Harness({ initial }: { initial: string }) {
  const [activeId, setActiveId] = useState(initial);
  return (
    <NoteTabs
      tabs={tabs}
      activeId={activeId}
      onSelect={(id) => {
        selected.push(id);
        setActiveId(id);
      }}
      onClose={(id) => closed.push(id)}
      onReorder={() => {}}
    />
  );
}

function mount(initial: string): void {
  act(() => {
    root.render(<Harness initial={initial} />);
  });
}

function tabElements(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function keydown(el: HTMLElement, key: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('NoteTabs keyboard reachability', () => {
  it('marks the bar as a tablist and gives only the active tab a Tab stop', () => {
    mount('b');
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const [a, b, c] = tabElements();
    expect(a.tabIndex).toBe(-1);
    expect(b.tabIndex).toBe(0);
    expect(c.tabIndex).toBe(-1);
  });

  it('selects the focused tab on Enter and Space', () => {
    mount('a');
    const [a] = tabElements();
    keydown(a, 'Enter');
    keydown(a, ' ');
    expect(selected).toEqual(['a', 'a']);
  });

  it('moves focus and switches with the arrow keys, wrapping at the ends, across real re-renders', () => {
    mount('a');
    keydown(tabElements()[0], 'ArrowRight');
    expect(selected).toEqual(['b']);
    // Roving tabindex: the newly active tab is now the only Tab stop, and it
    // is also where DOM focus actually landed, not just where it logically
    // should be.
    expect(tabElements()[1].tabIndex).toBe(0);
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('b');

    keydown(tabElements()[1], 'ArrowLeft');
    expect(selected).toEqual(['b', 'a']);
    expect(tabElements()[0].tabIndex).toBe(0);

    keydown(tabElements()[0], 'ArrowLeft');
    expect(selected).toEqual(['b', 'a', 'c']); // wraps past the first tab to the last
    expect(tabElements()[2].tabIndex).toBe(0);
  });

  it('jumps to the first and last tab on Home and End', () => {
    mount('b');
    keydown(tabElements()[1], 'End');
    expect(selected).toEqual(['c']);

    keydown(tabElements()[2], 'Home');
    expect(selected).toEqual(['c', 'a']);
  });

  it('leaves the close button reachable and independent of the tab body', () => {
    mount('a');
    const closeButtons = [...container.querySelectorAll('button')];
    expect(closeButtons.length).toBe(tabs.length);
    act(() => {
      closeButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(closed).toEqual(['b']);
    // The close click stops its own propagation, so it never also selects.
    expect(selected).toEqual([]);
  });
});
