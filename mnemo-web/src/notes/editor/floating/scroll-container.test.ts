// @vitest-environment jsdom

/**
 * The box a floating layer measures itself against. jsdom lays nothing out, so
 * both the scroller and its rect are described rather than built; what is under
 * test is the decision, not the measurement.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { anchorInContainer, scrollContainerOf } from './scroll-container';

afterEach(() => {
  document.body.replaceChildren();
});

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function scroller(overflowY: string, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  el.style.overflowY = overflowY;
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  return el;
}

function withRect(el: HTMLElement, box: Box): HTMLElement {
  el.getBoundingClientRect = () =>
    ({ ...box, width: box.right - box.left, height: box.bottom - box.top }) as DOMRect;
  return el;
}

function nest(...elements: HTMLElement[]): HTMLElement {
  document.body.appendChild(elements[0]);
  for (let i = 1; i < elements.length; i++) elements[i - 1].appendChild(elements[i]);
  return elements[elements.length - 1];
}

describe('finding the scroller', () => {
  it('walks past a plain ancestor to the one that scrolls', () => {
    const scrolling = scroller('auto', 2000, 400);
    const plain = document.createElement('div');
    const leaf = document.createElement('div');
    nest(scrolling, plain, leaf);
    expect(scrollContainerOf(leaf)).toBe(scrolling);
  });

  it('ignores an overflow that has nothing to scroll', () => {
    const notScrolling = scroller('auto', 400, 400);
    const leaf = document.createElement('div');
    nest(notScrolling, leaf);
    expect(scrollContainerOf(leaf)).toBeNull();
  });

  it('ignores a visible overflow however tall its content is', () => {
    const visible = scroller('visible', 2000, 400);
    const leaf = document.createElement('div');
    nest(visible, leaf);
    expect(scrollContainerOf(leaf)).toBeNull();
  });

  it('takes the nearest of two scrollers, since that is the one that clips', () => {
    const outer = scroller('auto', 2000, 400);
    const inner = scroller('scroll', 900, 200);
    const leaf = document.createElement('div');
    nest(outer, inner, leaf);
    expect(scrollContainerOf(leaf)).toBe(inner);
  });
});

describe('whether the anchor is still worth pointing at', () => {
  const container = () => withRect(document.createElement('div'), { top: 100, bottom: 500, left: 0, right: 800 });

  it('says yes for an anchor inside the box', () => {
    expect(anchorInContainer({ top: 200, bottom: 220, left: 40, right: 90 }, container())).toBe(true);
  });

  it('says yes while the anchor is only half out, which is where it still reads', () => {
    expect(anchorInContainer({ top: 90, bottom: 110, left: 40, right: 90 }, container())).toBe(true);
  });

  it('says no once it has scrolled off the top', () => {
    expect(anchorInContainer({ top: 20, bottom: 40, left: 40, right: 90 }, container())).toBe(false);
  });

  it('says no once it has scrolled off the bottom', () => {
    expect(anchorInContainer({ top: 600, bottom: 620, left: 40, right: 90 }, container())).toBe(false);
  });

  it('says no for an anchor past the box sideways', () => {
    expect(anchorInContainer({ top: 200, bottom: 220, left: 900, right: 950 }, container())).toBe(false);
  });

  /** The note fills the window, so there is nothing for it to scroll out of. */
  it('says yes when nothing above the editor scrolls', () => {
    expect(anchorInContainer({ top: -400, bottom: -380, left: 0, right: 10 }, null)).toBe(true);
  });
});
