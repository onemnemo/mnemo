// @vitest-environment jsdom

/**
 * The tab overflow menu and nested note tooltips. jsdom lays nothing out, so the test
 * supplies the strip widths and fires the resize itself.
 */

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installControllableResizeObserver, type ResizeObserverController } from '@/test/setup';

import { NoteTabs, type NoteTab } from './NoteTabs';

vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tabs: readonly NoteTab[] = [
  { id: 'a', title: 'Anatomy', emoji: null },
  { id: 'b', title: 'Biology', emoji: null, parents: ['Anatomy'] },
  { id: 'c', title: 'Cells', emoji: null, parents: ['Anatomy', 'Biology'] },
];

let container: HTMLElement;
let root: Root;
let resize: ResizeObserverController;
let widths: { client: number; scroll: number };
let selected: string[];
let scrolled: string[];

beforeEach(() => {
  widths = { client: 300, scroll: 300 };
  selected = [];
  scrolled = [];
  resize = installControllableResizeObserver();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => widths.client);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scroll);
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.tabId ?? '');
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

function mount(activeId = 'a', list: readonly NoteTab[] = tabs): void {
  act(() => {
    root.render(
      <StrictMode>
        <NoteTabs
          tabs={list}
          activeId={activeId}
          onSelect={(id) => selected.push(id)}
          onClose={() => {}}
          onCloseScope={() => {}}
          onReorder={() => {}}
        />
      </StrictMode>,
    );
  });
}

const trigger = () => container.querySelector<HTMLElement>('button[aria-label="OpenTabsMenu"]');

describe('the tab overflow menu', () => {
  it('stays away while the tabs fit', () => {
    mount();
    expect(trigger()).toBeNull();
  });

  it('appears when the tabs outgrow the strip and goes when they fit again', () => {
    mount();
    widths.scroll = 600;
    act(() => resize.trigger(280));
    expect(trigger()).not.toBeNull();

    widths.scroll = 300;
    act(() => resize.trigger(340));
    expect(trigger()).toBeNull();
  });

  it('appears when a new tab tips the strip over, with no resize', () => {
    mount();
    widths.scroll = 600;
    mount('a', [...tabs, { id: 'd', title: 'Dental', emoji: null }]);
    expect(trigger()).not.toBeNull();
  });

  it('measures again when the active tab changes, as its heavier weight changes the widths', () => {
    mount('a');
    widths.scroll = 600;
    mount('b');
    expect(trigger()).not.toBeNull();
  });

  it('measures again when the fonts finish loading', async () => {
    let loaded: () => void = () => {};
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: new Promise<void>((resolve) => (loaded = resolve)) },
    });
    try {
      mount();
      widths.scroll = 600;
      expect(trigger()).toBeNull();
      await act(async () => loaded());
      expect(trigger()).not.toBeNull();
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it('does not measure again when the parent hands in a new expand callback on each render', () => {
    const reads = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => {
      reads();
      return widths.scroll;
    });
    const render = () =>
      act(() => {
        root.render(
          <StrictMode>
            <NoteTabs
              tabs={tabs}
              activeId="a"
              onSelect={() => {}}
              onClose={() => {}}
              onCloseScope={() => {}}
              onReorder={() => {}}
              onExpandSidebar={() => {}}
            />
          </StrictMode>,
        );
      });
    render();
    const after = reads.mock.calls.length;
    render();
    render();
    expect(reads.mock.calls.length).toBe(after);
  });

  it('keeps its slot whether or not the button shows, so nothing moves', () => {
    mount();
    const slot = () => container.querySelector('.size-8')?.className;
    const before = slot();
    widths.scroll = 600;
    act(() => resize.trigger(280));
    expect(slot()).toBe(before);
  });

  it('lists every open tab with the active one marked', async () => {
    mount('b');
    widths.scroll = 600;
    act(() => resize.trigger(280));
    await act(async () => {
      trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => el.textContent?.trim())).toEqual(['Anatomy', 'Biology', 'Cells']);
    expect(items.map((el) => el.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('names the parent only beside a title another open tab shares', async () => {
    mount('a', [...tabs, { id: 'd', title: 'Cells', emoji: null, parents: ['Physics'] }]);
    widths.scroll = 600;
    act(() => resize.trigger(280));
    await act(async () => {
      trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((el) => el.textContent?.trim())).toEqual(['Anatomy', 'Biology', 'CellsBiology', 'CellsPhysics']);
  });

  it('activates the chosen tab', async () => {
    mount('a');
    widths.scroll = 600;
    act(() => resize.trigger(280));
    await act(async () => {
      trigger()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')][2];
    await act(async () => item.click());
    expect(selected).toEqual(['c']);
  });
});

describe('nested tabs', () => {
  it('show the notes above them in their tooltip and leave a top level tab without one', () => {
    mount();
    const titles = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map((el) => el.getAttribute('title'));
    expect(titles).toEqual([null, 'Anatomy / Biology', 'Anatomy / Biology / Cells']);
  });

  it('scroll the active tab into view when it changes', () => {
    mount('a');
    scrolled.length = 0;
    mount('c');
    expect(scrolled).toEqual(['c']);
  });
});
