// @vitest-environment jsdom

/**
 * Keyboard reachability for the tab strip, and the right-click menu that hangs
 * off each tab. Before this, a tab's whole switch surface was a `<div onClick>`
 * with no `tabIndex` and no `onKeyDown`, so a keyboard user could reach the
 * close button on a tab but never the tab itself: Tab skipped straight over it.
 * Checked here rather than left to a visual read, since a missing tab stop
 * leaves nothing on screen to notice.
 *
 * The harness re-renders on every select and owns the tab list, the way the real
 * workspace does by feeding `activeId` and the derived tabs back from its own
 * state, so the roving tabindex and the focus a close leaves behind are checked
 * across an actual update and not just at a single fixed render.
 */

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoteTabs, type NoteTab } from './NoteTabs';
import { tabsToClose, type TabCloseScope } from './tabs';

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
let scoped: { id: string; scope: TabCloseScope }[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  selected = [];
  closed = [];
  scoped = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** A minimal stand-in for the workspace: owns `activeId` and the strip, feeds both straight back in. */
function Harness({ initial }: { initial: string }) {
  const [activeId, setActiveId] = useState(initial);
  const [list, setList] = useState<readonly NoteTab[]>(tabs);
  return (
    <NoteTabs
      tabs={list}
      activeId={activeId}
      onSelect={(id) => {
        selected.push(id);
        setActiveId(id);
      }}
      onClose={(id) => {
        closed.push(id);
        setList((current) => current.filter((tab) => tab.id !== id));
      }}
      onCloseScope={(id, scope) => {
        scoped.push({ id, scope });
        setList((current) => {
          const gone = new Set(tabsToClose(current.map((tab) => tab.id), id, scope));
          return current.filter((tab) => !gone.has(tab.id));
        });
      }}
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

/**
 * A menu settles over two turns: it mounts on one and hands focus back from a
 * timeout on the next, and the focus the strip moves has to survive that.
 */
async function settle(): Promise<void> {
  await act(async () => {});
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The press a right-click makes, and the one Shift+F10 makes without any press at all. */
function openContextMenu(el: HTMLElement): void {
  act(() => {
    el.focus();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function chooseMenuItem(label: string): void {
  const item = menuItems().find((el) => el.textContent === label);
  expect(item, `no menu item labelled ${label}`).not.toBeUndefined();
  act(() => item!.click());
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

  it('closes a tab on the middle button, and swallows the platform scroll widget', () => {
    mount('a');
    const press = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 1,
      pointerId: 1,
      isPrimary: true,
    });
    act(() => {
      tabElements()[1].dispatchEvent(press);
    });

    expect(closed).toEqual(['b']);
    expect(press.defaultPrevented).toBe(true);
    // A middle press is a close, never the start of a reorder or a switch.
    expect(selected).toEqual([]);
  });

  it('still starts a drag from the primary button', () => {
    mount('a');
    act(() => {
      tabElements()[1].dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    });
    expect(closed).toEqual([]);
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

describe('NoteTabs context menu', () => {
  it("keeps the tabs as the tablist's own children, so the menu costs no structure", () => {
    mount('a');
    const bar = container.querySelector<HTMLElement>('[role="tablist"]')!;
    const own = [...bar.children].filter((child) => child.getAttribute('role') === 'tab');
    expect(own.length).toBe(tabs.length);
  });

  it('opens on a bare contextmenu event, which is all the keyboard sends', () => {
    mount('a');
    openContextMenu(tabElements()[1]);
    expect(menuItems().map((el) => el.textContent)).toEqual([
      'CloseTab',
      'CloseOtherTabs',
      'CloseTabsToTheLeft',
      'CloseTabsToTheRight',
    ]);
  });

  it('greys out the verbs the tab has nothing to act on', () => {
    mount('a');
    openContextMenu(tabElements()[0]);
    const disabled = menuItems()
      .filter((el) => el.getAttribute('aria-disabled') === 'true')
      .map((el) => el.textContent);
    expect(disabled).toEqual(['CloseTabsToTheLeft']);
  });

  it('still roves with the arrows once a menu has been up', async () => {
    mount('b');
    openContextMenu(tabElements()[1]);
    expect(tabElements()[1].tabIndex).toBe(0);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(menuItems()).toEqual([]);

    keydown(tabElements()[1], 'ArrowRight');
    expect(selected).toEqual(['c']);
  });

  it('leaves focus on a tab after closing the one the menu was raised on', async () => {
    mount('b');
    openContextMenu(tabElements()[1]);
    chooseMenuItem('CloseTab');
    await settle();

    expect(closed).toEqual(['b']);
    // Radix hands focus back to the trigger, and the trigger is the tab that was
    // just unmounted, so without a move of its own the keyboard lands on nothing.
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('c');
  });

  it('closes the rest and keeps focus on the tab that was kept', async () => {
    mount('a');
    openContextMenu(tabElements()[2]);
    chooseMenuItem('CloseOtherTabs');
    await settle();

    expect(scoped).toEqual([{ id: 'c', scope: 'others' }]);
    expect(tabElements().map((el) => el.dataset.tabId)).toEqual(['c']);
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('c');
  });

  it('closes only one side and keeps focus on the tab the menu was raised on', async () => {
    mount('a');
    openContextMenu(tabElements()[1]);
    chooseMenuItem('CloseTabsToTheRight');
    await settle();

    expect(scoped).toEqual([{ id: 'b', scope: 'right' }]);
    expect(tabElements().map((el) => el.dataset.tabId)).toEqual(['a', 'b']);
    expect(document.activeElement?.getAttribute('data-tab-id')).toBe('b');
  });
});
