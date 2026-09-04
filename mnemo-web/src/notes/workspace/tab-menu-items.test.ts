/**
 * The tab menu's list, checked without a DOM: what it offers, in what order, and
 * which rows it greys out where the verb has nothing to act on. The labels are
 * looked up against the real bundle too, because translate.ts answers a miss with
 * the bare key and a menu row reading `CloseOtherTabs` would ship unnoticed.
 */

import { describe, expect, it, vi } from 'vitest';

import { mergedEnglishBundle, resolves } from '@/i18n/test-bundle';
import type { TranslateFn } from '@/i18n/types';

import { tabMenuItems, type TabMenuEntry, type TabMenuHandlers } from './tab-menu-items';

const t: TranslateFn = (_ns, key) => key;

function handlers(over: Partial<TabMenuHandlers> = {}): TabMenuHandlers {
  return {
    close: vi.fn(),
    closeOthers: vi.fn(),
    closeLeft: vi.fn(),
    closeRight: vi.fn(),
    ...over,
  };
}

function build(index: number, count: number, on: TabMenuHandlers = handlers()): readonly TabMenuEntry[] {
  return tabMenuItems({ index, count, t, on });
}

function ids(entries: readonly TabMenuEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

function item(entries: readonly TabMenuEntry[], id: string) {
  const found = entries.find((entry) => entry.id === id);
  expect(found, `no entry ${id}`).toBeDefined();
  expect(found!.kind).toBe('item');
  return found as Extract<TabMenuEntry, { kind: 'item' }>;
}

describe('the note tab menu', () => {
  it('offers the close verbs, and nothing above them, on a build with no panel or window', () => {
    // No separator either: it would sit at the top with nothing to divide.
    expect(ids(build(1, 3))).toEqual(['close', 'close-others', 'close-left', 'close-right']);
  });

  it('puts the surfaces a note can move to above the close verbs, once they exist', () => {
    const entries = build(1, 3, handlers({ openInPeek: vi.fn(), moveToWindow: vi.fn() }));
    expect(ids(entries)).toEqual([
      'peek',
      'window',
      'sep.close',
      'close',
      'close-others',
      'close-left',
      'close-right',
    ]);
    expect(entries[2].kind).toBe('separator');
  });

  it('offers each surface on its own, so one capability does not wait on the other', () => {
    expect(ids(build(1, 3, handlers({ openInPeek: vi.fn() })))).toContain('peek');
    expect(ids(build(1, 3, handlers({ openInPeek: vi.fn() })))).not.toContain('window');
    expect(ids(build(1, 3, handlers({ moveToWindow: vi.fn() })))).toContain('window');
    expect(ids(build(1, 3, handlers({ moveToWindow: vi.fn() })))).not.toContain('peek');
  });

  it('always lets the tab itself be closed', () => {
    expect(item(build(0, 1), 'close').disabled).toBeFalsy();
  });

  it('greys out closing the others when this is the only tab', () => {
    expect(item(build(0, 1), 'close-others').disabled).toBe(true);
    expect(item(build(0, 2), 'close-others').disabled).toBe(false);
  });

  it('greys out the side that has no tabs on it', () => {
    const first = build(0, 3);
    expect(item(first, 'close-left').disabled).toBe(true);
    expect(item(first, 'close-right').disabled).toBe(false);

    const last = build(2, 3);
    expect(item(last, 'close-left').disabled).toBe(false);
    expect(item(last, 'close-right').disabled).toBe(true);

    const only = build(0, 1);
    expect(item(only, 'close-left').disabled).toBe(true);
    expect(item(only, 'close-right').disabled).toBe(true);
  });

  it('runs the handler the chosen row stands for', () => {
    const on = handlers({ openInPeek: vi.fn() });
    const entries = build(1, 3, on);
    item(entries, 'close-others').run();
    item(entries, 'peek').run();
    expect(on.closeOthers).toHaveBeenCalledOnce();
    expect(on.openInPeek).toHaveBeenCalledOnce();
    expect(on.close).not.toHaveBeenCalled();
  });
});

describe('the note tab menu copy', () => {
  const bundle = mergedEnglishBundle();

  it.each(['OpenInSidePeek', 'CloseTab', 'CloseOtherTabs', 'CloseTabsToTheLeft', 'CloseTabsToTheRight'])(
    'resolves Notes/%s',
    (key) => {
      expect(resolves(bundle, 'Notes', key), `Notes/${key} is missing from the merged bundle`).toBe(true);
    },
  );
});
