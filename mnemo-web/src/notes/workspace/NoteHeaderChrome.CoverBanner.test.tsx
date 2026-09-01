// @vitest-environment jsdom

/**
 * The banner's crop layout only ever finishes once three independent things have all
 * answered: the asset bytes (an object URL), the banner's own measured width, and the
 * picture's decoded natural size. This drives each by hand rather than through a real
 * asset fetch, since nothing in this tree yet fakes that pipeline end to end.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installControllableResizeObserver, type ResizeObserverController } from '@/test/setup';

import { CoverBanner } from './NoteHeaderChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const assetUrl = vi.hoisted(() => ({ current: null as string | null }));

vi.mock('@/api/asset-blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/asset-blob')>()),
  useAssetObjectUrl: () => assetUrl.current,
}));

let container: HTMLElement;
let root: Root;
let resizeObserver: ResizeObserverController;

beforeEach(() => {
  resizeObserver = installControllableResizeObserver();
  assetUrl.current = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount(token: string | null, crop: string | null): void {
  act(() => {
    root.render(<CoverBanner token={token} crop={crop} />);
  });
}

function resizeTo(width: number): void {
  act(() => {
    resizeObserver.trigger(width);
  });
}

function img(): HTMLImageElement | null {
  return container.querySelector('img');
}

/** Fires the image's load event with a decoded natural size, the way a real one would. */
function decode(width: number, height: number): void {
  const element = img();
  expect(element).not.toBeNull();
  Object.defineProperty(element, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'naturalHeight', { value: height, configurable: true });
  act(() => {
    element?.dispatchEvent(new Event('load'));
  });
}

describe('CoverBanner', () => {
  it('renders nothing for a note with no cover', () => {
    mount(null, null);
    expect(container.firstChild).toBeNull();
  });

  it('draws a preset as a plain gradient, ignoring any crop', () => {
    mount('sunset', '{"x":0,"y":0,"w":0.5,"h":0.5,"aspect":1}');
    expect(container.querySelector('div')).not.toBeNull();
    expect(img()).toBeNull();
  });

  it('shows nothing yet for a custom cover whose bytes have not arrived', () => {
    mount('asset:abcd.png', null);
    resizeTo(900);
    expect(img()).toBeNull();
  });

  it('falls back to plain cover fit for a custom cover with no crop', () => {
    assetUrl.current = 'blob:pic';
    mount('asset:abcd.png', null);
    resizeTo(900);
    decode(2000, 1000);

    expect(img()?.className).toContain('object-cover');
  });

  it('falls back to plain cover fit for a crop this build cannot parse', () => {
    assetUrl.current = 'blob:pic';
    mount('asset:abcd.png', 'not json');
    resizeTo(900);
    decode(2000, 1000);

    expect(img()?.className).toContain('object-cover');
  });

  it('positions the picture by the stored crop once the width and the decode both answer', () => {
    assetUrl.current = 'blob:pic';
    // The right half of a 2000x1000 source, framed for a 900-wide, 140-tall band.
    mount('asset:abcd.png', '{"x":0.5,"y":0,"w":0.5,"h":1,"aspect":6.4286}');
    resizeTo(900);
    decode(2000, 1000);

    const element = img();
    expect(element?.className).toContain('absolute');
    expect(element?.style.width).toBe('1800px');
    expect(element?.style.height).toBe('900px');
    expect(element?.style.left).toBe('-900px');
    expect(element?.style.top).toBe('-380px');
  });

  it('reframes as the band widens, without waiting for a new decode', () => {
    assetUrl.current = 'blob:pic';
    mount('asset:abcd.png', '{"x":0.5,"y":0,"w":0.5,"h":1,"aspect":6.4286}');
    resizeTo(900);
    decode(2000, 1000);

    resizeTo(1200);

    const element = img();
    expect(element?.style.width).toBe('2400px');
    expect(element?.style.left).toBe('-1200px');
  });
});
