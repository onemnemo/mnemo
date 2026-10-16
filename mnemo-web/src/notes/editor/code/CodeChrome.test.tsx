// @vitest-environment jsdom

/** A caption turned on from the options menu keeps the caret when the menu restores focus late. */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeChrome, type CodeChromeProps } from './CodeChrome';

vi.mock('@/i18n/useT', () => ({ useT: () => (_ns: string, key: string) => key }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let field: HTMLInputElement;
let frames: FrameRequestCallback[];

function mount(props: Partial<CodeChromeProps> = {}): void {
  const onCaption = () => {
    requestAnimationFrame(() => field.focus());
  };
  act(() => {
    root.render(
      <CodeChrome
        language="ts"
        wrap={false}
        numbers={false}
        caption={false}
        onLanguage={() => {}}
        onWrap={() => {}}
        onNumbers={() => {}}
        onCaption={onCaption}
        onCopy={() => Promise.resolve(true)}
        {...props}
      />,
    );
  });
}

const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="CodeOptions"]')!;

function openMenu(): void {
  act(() => {
    trigger().focus();
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find((e) => e.textContent?.includes(label))!;

/** WebKit runs the frame first and the menu's focus restore after it. */
async function runFramesThenTimers(): Promise<void> {
  await act(async () => {
    frames.splice(0).forEach((frame) => frame(0));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  host = document.createElement('div');
  document.body.appendChild(host);
  field = document.createElement('input');
  document.body.appendChild(field);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  field.remove();
  vi.unstubAllGlobals();
});

describe('the code block options menu', () => {
  it('leaves the caret in the caption field after Caption is chosen', async () => {
    mount();
    openMenu();
    act(() => item('CodeCaption').click());
    await runFramesThenTimers();
    expect(document.activeElement).toBe(field);
  });

  it('still returns focus to the trigger when another item is chosen', async () => {
    mount();
    openMenu();
    act(() => item('CodeWrap').click());
    await runFramesThenTimers();
    expect(document.activeElement).toBe(trigger());
  });

  it('returns focus to the trigger when Caption is chosen to turn it off', async () => {
    mount({ caption: true });
    openMenu();
    act(() => item('CodeCaption').click());
    await runFramesThenTimers();
    expect(document.activeElement).toBe(trigger());
  });
});
