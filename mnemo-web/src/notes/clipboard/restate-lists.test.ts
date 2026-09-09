// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { restateLists } from './restate-lists';

/** Parses HTML the way the sanitiser does, minus the scrubbing this is not about. */
function fragmentOf(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

function restated(html: string): DocumentFragment {
  const fragment = fragmentOf(html);
  restateLists(fragment);
  return fragment;
}

/** The marker each top-level element carries, so a shape is easy to assert against. */
function markers(parent: ParentNode): string[] {
  return Array.from(parent.children).map((element) => {
    if (element.hasAttribute('data-bullet')) return 'bullet';
    if (element.hasAttribute('data-numbered')) return 'numbered';
    if (element.hasAttribute('data-checklist')) return `checklist:${element.getAttribute('data-checked') ?? ''}`;
    if (element.hasAttribute('data-line')) return 'line';
    return element.tagName.toLowerCase();
  });
}

function lineText(item: Element): string {
  return item.querySelector(':scope > [data-line]')?.textContent ?? '';
}

describe('restateLists', () => {
  it('turns a flat list into a run of sibling items, each opening with its line', () => {
    const fragment = restated('<ul><li>one</li><li>two</li></ul>');

    expect(markers(fragment)).toEqual(['bullet', 'bullet']);
    expect(Array.from(fragment.children).map(lineText)).toEqual(['one', 'two']);
    expect(fragment.querySelector('ul')).toBeNull();
  });

  it('numbers the items of an ordered list', () => {
    expect(markers(restated('<ol><li>a</li><li>b</li></ol>'))).toEqual(['numbered', 'numbered']);
  });

  it('nests a sub-list inside its item as that item\'s trailing blocks', () => {
    const fragment = restated('<ul><li>parent<ul><li>child</li></ul></li><li>after</li></ul>');

    const [parent] = Array.from(fragment.children);
    expect(markers(fragment)).toEqual(['bullet', 'bullet']);
    expect(markers(parent)).toEqual(['line', 'bullet']);
    expect(lineText(parent)).toBe('parent');
    expect(lineText(parent.children[1])).toBe('child');
  });

  it("nests a sub-list written beside its item, which is Google Docs' shape", () => {
    const fragment = restated('<ul><li>parent</li><ul><li>child</li></ul><li>after</li></ul>');

    expect(markers(fragment)).toEqual(['bullet', 'bullet']);
    expect(markers(fragment.children[0])).toEqual(['line', 'bullet']);
    expect(lineText(fragment.children[1])).toBe('after');
  });

  it('hoists a sub-list with no item before it', () => {
    expect(markers(restated('<ul><ul><li>orphan</li></ul></ul>'))).toEqual(['bullet']);
  });

  it('keeps the inline formatting inside an item on its line', () => {
    const fragment = restated('<ul><li>plain <b>bold</b> <a href="https://x.test">link</a></li></ul>');

    const line = fragment.children[0].querySelector('[data-line]')!;
    expect(line.querySelector('b')?.textContent).toBe('bold');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('https://x.test');
  });

  it("reads a loose item's first paragraph as its line and the rest as its children", () => {
    const fragment = restated('<ul><li><p>first</p><p>second</p></li></ul>');

    const [item] = Array.from(fragment.children);
    expect(markers(item)).toEqual(['line', 'p']);
    expect(lineText(item)).toBe('first');
    expect(item.children[1].textContent).toBe('second');
  });

  it('opens on a wrapper of spans the way a word processor writes an item', () => {
    const fragment = restated('<ul><li dir="ltr"><p dir="ltr"><span>Item</span></p></li></ul>');

    expect(markers(fragment.children[0])).toEqual(['line']);
    expect(lineText(fragment.children[0])).toBe('Item');
  });

  it('turns a break inside an item into a newline on its line', () => {
    expect(lineText(restated('<ul><li>one<br>two</li></ul>').children[0])).toBe('one\ntwo');
  });

  it('gives text that follows a sub-list a paragraph of its own instead of the line above', () => {
    const fragment = restated('<ul><li>head<ul><li>child</li></ul>tail</li></ul>');

    const [item] = Array.from(fragment.children);
    expect(markers(item)).toEqual(['line', 'bullet', 'p']);
    expect(lineText(item)).toBe('head');
    expect(item.children[2].textContent).toBe('tail');
  });

  it('reads an item that leads with a checkbox as a to-do, ticked or not', () => {
    const fragment = restated(
      '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>',
    );

    expect(markers(fragment)).toEqual(['checklist:true', 'checklist:false']);
    expect(lineText(fragment.children[0])).toBe(' done');
    expect(fragment.querySelector('input')).toBeNull();
  });

  it('finds the checkbox through the paragraph a renderer wraps it in', () => {
    const fragment = restated('<ul><li><p><input type="checkbox" checked> done</p></li></ul>');

    expect(markers(fragment)).toEqual(['checklist:true']);
  });

  it('leaves a list inside a table cell for the table pass to flatten', () => {
    const fragment = fragmentOf('<table><tr><td><ul><li>in a cell</li></ul></td></tr></table>');
    restateLists(fragment);

    expect(fragment.querySelector('td > li[data-bullet]')).not.toBeNull();
  });

  it('lets something that is not an item leave the list as itself', () => {
    expect(markers(restated('<ul><li>item</li><p>stray</p></ul>'))).toEqual(['bullet', 'p']);
  });

  it('leaves a fragment with no list untouched', () => {
    const fragment = fragmentOf('<p>a</p><p>b</p>');
    restateLists(fragment);

    expect(markers(fragment)).toEqual(['p', 'p']);
  });
});
