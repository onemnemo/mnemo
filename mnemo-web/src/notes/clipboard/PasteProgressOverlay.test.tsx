// @vitest-environment jsdom

/**
 * The staging overlay renders into the document body (never the editor DOM),
 * mirrors the shared progress store, and cancels through the callback the store
 * carries, by button and by Escape.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PasteProgressOverlay } from './PasteProgressOverlay';
import { storePasteProgress } from './paste-progress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PasteProgressOverlay />));
});

afterEach(() => {
  act(() => storePasteProgress.end());
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const card = () => document.body.querySelector('[role="status"]');

describe('PasteProgressOverlay', () => {
  it('renders nothing while idle', () => {
    expect(card()).toBeNull();
  });

  it('shows a body-level card while staging and clears when done', () => {
    act(() => storePasteProgress.begin(3, () => {}));
    const status = card();
    expect(status).not.toBeNull();
    // Portalled to the body, outside the component's own container.
    expect(container.contains(status)).toBe(false);

    act(() => storePasteProgress.end());
    expect(card()).toBeNull();
  });

  it('cancels through the store callback when the button is clicked', () => {
    const onCancel = vi.fn();
    act(() => storePasteProgress.begin(2, onCancel));

    const button = document.body.querySelector<HTMLButtonElement>('[role="status"] button');
    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    act(() => storePasteProgress.begin(2, onCancel));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
