// @vitest-environment jsdom

/**
 * The roving tabindex, exercised over plain buttons rather than through either
 * surface that uses it. What is being proved here is the group arithmetic, and
 * a real toolbar would drag the command catalog and a live document in with it.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createRovingFocus, type RovingFocus } from './roving-focus';

afterEach(() => {
  document.body.replaceChildren();
});

/** `n` buttons in the document, since jsdom will not focus a detached element. */
function buttons(n: number): HTMLButtonElement[] {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return Array.from({ length: n }, (_, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.index = String(i);
    host.appendChild(el);
    return el;
  });
}

function press(group: RovingFocus, key: string, init: KeyboardEventInit = {}): boolean {
  return group.handleKey(new KeyboardEvent('keydown', { key, ...init }));
}

function focusedIndex(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.dataset.index;
}

/** The single control carrying the group's tab stop, by its index attribute. */
function tabStop(row: readonly HTMLButtonElement[]): string | undefined {
  const stops = row.filter((el) => el.tabIndex === 0);
  if (stops.length !== 1) throw new Error(`expected one tab stop, found ${String(stops.length)}`);
  return stops[0].dataset.index;
}

describe('one tab stop', () => {
  it('settles on the first control', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.sync();
    expect(tabStop(row)).toBe('0');
  });

  it('follows the arrows, so the group is re-entered where it was left', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.sync();
    press(group, 'ArrowRight');
    expect(tabStop(row)).toBe('1');
  });

  /**
   * Availability moves with the caret, so a group that captured its controls
   * would offer a disabled one as the way in. Re-reading is the whole reason
   * the rows arrive as a callback.
   */
  it('moves off a control that has just been disabled', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.sync();
    expect(tabStop(row)).toBe('0');
    row[0].disabled = true;
    group.sync();
    expect(tabStop(row)).toBe('1');
  });

  it('reset puts it back at the start', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.sync();
    press(group, 'End');
    expect(tabStop(row)).toBe('2');
    group.reset();
    expect(tabStop(row)).toBe('0');
  });
});

describe('moving along a row', () => {
  it('focus lands on the first available control', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    expect(group.focus()).toBe(true);
    expect(focusedIndex()).toBe('0');
  });

  it('walks right and left', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.focus();
    press(group, 'ArrowRight');
    expect(focusedIndex()).toBe('1');
    press(group, 'ArrowLeft');
    expect(focusedIndex()).toBe('0');
  });

  /** A ring this short reads as stuck rather than bounded when the ends refuse. */
  it('wraps at both ends', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.focus();
    press(group, 'ArrowLeft');
    expect(focusedIndex()).toBe('2');
    press(group, 'ArrowRight');
    expect(focusedIndex()).toBe('0');
  });

  it('skips a disabled control rather than landing on it', () => {
    const row = buttons(4);
    row[1].disabled = true;
    row[2].disabled = true;
    const group = createRovingFocus(() => [row]);
    group.focus();
    press(group, 'ArrowRight');
    expect(focusedIndex()).toBe('3');
  });

  it('Home and End reach the ends in one press', () => {
    const row = buttons(4);
    const group = createRovingFocus(() => [row]);
    group.focus();
    press(group, 'End');
    expect(focusedIndex()).toBe('3');
    press(group, 'Home');
    expect(focusedIndex()).toBe('0');
  });

  it('End stops short of a disabled last control', () => {
    const row = buttons(4);
    row[3].disabled = true;
    const group = createRovingFocus(() => [row]);
    group.focus();
    press(group, 'End');
    expect(focusedIndex()).toBe('2');
  });
});

describe('moving between rows', () => {
  function grid(): { rows: HTMLButtonElement[][]; group: RovingFocus } {
    const all = buttons(7);
    const rows = [all.slice(0, 4), all.slice(4)];
    return { rows, group: createRovingFocus(() => rows) };
  }

  it('crosses to the other row', () => {
    const { group } = grid();
    group.focus();
    press(group, 'ArrowDown');
    expect(focusedIndex()).toBe('4');
  });

  it('keeps the column across the crossing', () => {
    const { group } = grid();
    group.focus();
    press(group, 'ArrowRight');
    press(group, 'ArrowRight');
    expect(focusedIndex()).toBe('2');
    press(group, 'ArrowDown');
    expect(focusedIndex()).toBe('6');
  });

  /** The palette's two rows are not the same length, and the shorter one must
   * still be reachable from anywhere in the longer one. */
  it('clamps the column to a shorter row', () => {
    const { group } = grid();
    group.focus();
    press(group, 'End');
    expect(focusedIndex()).toBe('3');
    press(group, 'ArrowDown');
    expect(focusedIndex()).toBe('6');
  });

  it('wraps back to the first row', () => {
    const { group } = grid();
    group.focus();
    press(group, 'ArrowUp');
    expect(focusedIndex()).toBe('4');
  });

  it('a single row has nowhere vertical to go, and says so', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.focus();
    expect(press(group, 'ArrowDown')).toBe(false);
    expect(focusedIndex()).toBe('0');
  });
});

describe('what the group declines', () => {
  it('leaves chords to whoever bound them', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.focus();
    expect(press(group, 'ArrowRight', { ctrlKey: true })).toBe(false);
    expect(press(group, 'Home', { altKey: true })).toBe(false);
    expect(focusedIndex()).toBe('0');
  });

  it('hands back every key it does not own', () => {
    const row = buttons(3);
    const group = createRovingFocus(() => [row]);
    group.focus();
    expect(press(group, 'Enter')).toBe(false);
    expect(press(group, 'Escape')).toBe(false);
    expect(press(group, 'a')).toBe(false);
  });

  it('refuses to take focus when every control is disabled', () => {
    const row = buttons(3);
    for (const el of row) el.disabled = true;
    const group = createRovingFocus(() => [row]);
    expect(group.focus()).toBe(false);
    expect(press(group, 'ArrowRight')).toBe(false);
  });

  it('refuses an empty group rather than throwing', () => {
    const group = createRovingFocus(() => [[]]);
    expect(group.focus()).toBe(false);
    expect(press(group, 'ArrowRight')).toBe(false);
    expect(() => {
      group.sync();
      group.reset();
    }).not.toThrow();
  });
});
