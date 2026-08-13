// @vitest-environment jsdom

/**
 * The save shortcut, at the level that matters: a key press reaches the save,
 * and the host's own "save page" command never does.
 *
 * These run off macOS, so Primary is Ctrl. The mac half of that mapping belongs
 * to `matchesEvent`, which owns it for every shortcut in the app and is tested
 * there rather than re-tested per binding.
 */

import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { getKeybindHandler } from '@/keybinds/registry';
import { SAVE_ACTION_ID, useSaveShortcut } from './useSaveShortcut';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
let mounted: boolean;
let save: Mock<() => void>;

function Host({ onSave }: { onSave: () => void }) {
  useSaveShortcut(onSave);
  return null;
}

function mount(onSave: () => void = save): void {
  act(() =>
    root.render(
      <StrictMode>
        <Host onSave={onSave} />
      </StrictMode>,
    ),
  );
  mounted = true;
}

function unmount(): void {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
}

/** Dispatches a key press on window and hands back the event, so its fate can be read. */
function press(init: KeyboardEventInit & { code: string }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const ctrlS = { code: 'KeyS', key: 's', ctrlKey: true } as const;

beforeEach(() => {
  save = vi.fn<() => void>();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(() => {
  unmount();
  container.remove();
});

describe('the save shortcut', () => {
  it('saves on Ctrl+S', () => {
    mount();
    press(ctrlS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('swallows the key, so the host never opens its save dialog over the editor', () => {
    mount();
    expect(press(ctrlS).defaultPrevented).toBe(true);
  });

  it('leaves every other chord alone', () => {
    mount();
    // Plain S is typing. Ctrl+Shift+S and Ctrl+Alt+S are other people's chords,
    // and a save that answers to a superset of its own binding steals them.
    for (const init of [
      { code: 'KeyS', key: 's' },
      { code: 'KeyS', key: 'S', ctrlKey: true, shiftKey: true },
      { code: 'KeyS', key: 's', ctrlKey: true, altKey: true },
      { code: 'KeyA', key: 'a', ctrlKey: true },
    ]) {
      expect(press(init).defaultPrevented).toBe(false);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('saves once for a held key rather than once per repeat', () => {
    mount();
    press(ctrlS);
    press({ ...ctrlS, repeat: true });
    press({ ...ctrlS, repeat: true });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('stands down when the keybind catalog already handled the press', () => {
    mount();
    // What the shared matcher does when a catalog entry matches: it prevents the
    // default and runs the registered handler itself. Saving again here would be
    // a second write for one key press.
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...ctrlS });
    event.preventDefault();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('registers the action so a catalog binding dispatches through the shared matcher', () => {
    mount();
    const handler = getKeybindHandler(SAVE_ACTION_ID);
    expect(handler).toBeTypeOf('function');
    handler?.();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('lets go of both the key and the action once the note is closed', () => {
    mount();
    unmount();
    expect(press(ctrlS).defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(getKeybindHandler(SAVE_ACTION_ID)).toBeUndefined();
  });

  it('always calls the save it was last given, not the one it mounted with', () => {
    // The surface passes a fresh closure whenever it re-renders. A listener that
    // captured the first one would keep writing through a session that is gone.
    const first = vi.fn();
    const second = vi.fn();
    mount(first);
    act(() =>
      root.render(
        <StrictMode>
          <Host onSave={second} />
        </StrictMode>,
      ),
    );
    press(ctrlS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
