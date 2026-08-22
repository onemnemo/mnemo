// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { isMarqueeOrigin } from './marquee-origin';

/** The element matching `selector` inside `markup`, as the press target. */
function target(markup: string, selector: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = markup;
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`fixture has no ${selector}`);
  return found;
}

describe('isMarqueeOrigin', () => {
  it('leaves a press on words to the browser', () => {
    const word = target('<div class="ProseMirror"><p><span id="w">one</span></p></div>', '#w');
    expect(isMarqueeOrigin(word)).toBe(false);
  });

  it('leaves a press on a blank block to the browser too', () => {
    // The empty part of a paragraph, and the padding under the last block, are
    // both the editable root: a caret belongs in either.
    const blank = target('<div class="ProseMirror"><p id="b"><br></p></div>', '#b');
    const root = target('<div class="ProseMirror" id="r"><p>one</p></div>', '#r');
    expect(isMarqueeOrigin(blank)).toBe(false);
    expect(isMarqueeOrigin(root)).toBe(false);
  });

  it('starts a marquee from the page around the editor', () => {
    const gutter = target('<div id="g" class="px"><div class="ProseMirror"><p>one</p></div></div>', '#g');
    expect(isMarqueeOrigin(gutter)).toBe(true);
  });

  it('leaves the surfaces that drag for themselves alone', () => {
    const cases: [string, string][] = [
      ['<div><button id="t">add</button></div>', '#t'],
      ['<div><a id="t" href="#">link</a></div>', '#t'],
      ['<div><input id="t"></div>', '#t'],
      ['<div><textarea id="t"></textarea></div>', '#t'],
      ['<div role="menuitem"><span id="t">rename</span></div>', '#t'],
      ['<div class="notes-table"><div id="t">cell</div></div>', '#t'],
      ['<div class="notes-column-splitter"><div id="t"></div></div>', '#t'],
    ];
    for (const [markup, selector] of cases) {
      expect(isMarqueeOrigin(target(markup, selector))).toBe(false);
    }
  });

  it('declines a target that is not an element', () => {
    expect(isMarqueeOrigin(null)).toBe(false);
    expect(isMarqueeOrigin(document.createTextNode('one'))).toBe(false);
  });
});
