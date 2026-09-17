// @vitest-environment jsdom

/**
 * The staging overlay is a takeover with a cancel in it. It sits under the toasts and the
 * dialog queue, so a confirm raised while a paste is being staged is reachable, and over
 * the modal band, so the app reads as busy under it.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Z_LAYERS } from '@/lib/z-layers';

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

describe('PasteProgressOverlay stacking', () => {
  it('sits on the progress tier, under the toasts and the dialog queue and over the modal band', () => {
    act(() => storePasteProgress.begin(3, () => {}));

    const scrim = document.body.querySelector<HTMLElement>('[role="status"]');
    expect(scrim).not.toBeNull();
    expect(scrim!.style.zIndex).toBe(String(Z_LAYERS.progress));
    expect(scrim!.className).not.toMatch(/z-\[/);

    expect(Z_LAYERS.progress).toBeLessThan(Z_LAYERS.toast);
    expect(Z_LAYERS.progress).toBeLessThan(Z_LAYERS.dialog);
    expect(Z_LAYERS.progress).toBeGreaterThan(Z_LAYERS.modal);
    expect(Z_LAYERS.progress).toBeGreaterThan(Z_LAYERS.modalMenu);
  });
});
