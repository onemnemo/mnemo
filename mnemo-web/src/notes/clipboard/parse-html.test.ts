// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { parseExternalHtml } from './parse-html';

const { schema } = createEditorSchema();

/** Every node type name in a slice, so a parse is easy to assert against. */
function typeNames(nodes: Iterable<PMNode>): string[] {
  const out: string[] = [];
  for (const node of nodes) out.push(node.type.name);
  return out;
}

function childrenOf(slice: { content: PMNode['content'] }): PMNode[] {
  const out: PMNode[] = [];
  slice.content.forEach((node) => out.push(node));
  return out;
}

describe('parseExternalHtml', () => {
  it('parses paragraphs into blocks with our schema', () => {
    const parsed = parseExternalHtml('<p>a</p><p>b</p>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(parsed.slice.content.childCount).toBe(2);
    expect(parsed.slice.content.child(0).textContent).toBe('a');
    expect(parsed.slice.content.child(1).textContent).toBe('b');
  });

  it('never yields a script or its text', () => {
    const parsed = parseExternalHtml('<p>hi</p><script>alert(1)</script>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(parsed.slice.content.textBetween(0, parsed.slice.content.size, '\n')).toBe('hi');
  });

  it('never yields an image node from a remote img', () => {
    const parsed = parseExternalHtml('<p>x</p><img src="http://tracker/x.png">', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(typeNames(childrenOf(parsed.slice))).not.toContain('image');
  });

  it('returns null for whitespace or comment-only HTML', () => {
    expect(parseExternalHtml('   ', schema)).toBeNull();
    expect(parseExternalHtml('<!-- nothing -->', schema)).toBeNull();
  });

  it('reports too-large without parsing', () => {
    expect(parseExternalHtml('a'.repeat(2_000_001), schema)).toBe('too-large');
  });

  it('strips a control character carried in a text node', () => {
    const parsed = parseExternalHtml('<p>a\u0001b</p>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(parsed.slice.content.textBetween(0, parsed.slice.content.size, '\n')).toBe('ab');
  });

  it('does not corrupt tag syntax by stripping a control character used as markup whitespace', () => {
    // \f and \r may separate an attribute from its tag name, so they must survive until parsed.
    const parsed = parseExternalHtml('<a\fhref="https://ok.test">link</a>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(parsed.slice.content.textBetween(0, parsed.slice.content.size, '\n')).toBe('link');
    let href: string | undefined;
    parsed.slice.content.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'link') href = String(mark.attrs.href);
      return true;
    });
    expect(href).toBe('https://ok.test');
  });

  it('parses a data table into a real table, cell marks and all', () => {
    const parsed = parseExternalHtml(
      '<p>before</p><table><tr><td><b>a</b></td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
      schema,
    );
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    expect(typeNames(childrenOf(parsed.slice))).toEqual(['paragraph', 'table']);

    const cells: string[] = [];
    const marks: string[] = [];
    parsed.slice.content.descendants((node) => {
      if (node.type.name === 'tableCell') cells.push(node.textContent);
      for (const mark of node.marks) marks.push(mark.type.name);
      return true;
    });
    expect(cells).toEqual(['a', 'b', 'c', 'd']);
    expect(marks).toContain('strong');
  });

  it('flattens a cell that wraps its text in blocks rather than nesting them in it', () => {
    const parsed = parseExternalHtml('<table><tr><td><p>one</p><p>two</p></td></tr></table>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');

    const nested: string[] = [];
    parsed.slice.content.descendants((node) => {
      if (node.type.name !== 'tableCell') return true;
      node.forEach((child, _offset, index) => {
        if (index > 0) nested.push(child.type.name);
      });
      return true;
    });
    expect(nested).toEqual([]);
    expect(parsed.slice.content.textBetween(0, parsed.slice.content.size, '')).toContain('one\ntwo');
  });

  it('parses a foreign list into sibling items, nesting and all', () => {
    const parsed = parseExternalHtml(
      '<ul><li>one</li><li>two<ul><li>two point one</li></ul></li></ul><ol><li>first</li></ol>',
      schema,
    );
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    const items = childrenOf(parsed.slice);
    expect(typeNames(items)).toEqual(['bulletItem', 'bulletItem', 'numberedItem']);

    const nested = items[1];
    expect(nested.childCount).toBe(2);
    expect(nested.child(0).type.name).toBe('line');
    expect(nested.child(0).textContent).toBe('two');
    expect(nested.child(1).type.name).toBe('bulletItem');
    expect(nested.child(1).textContent).toBe('two point one');
  });

  it('parses a task list into checklist items that keep their state', () => {
    const parsed = parseExternalHtml(
      '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>',
      schema,
    );
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    const items = childrenOf(parsed.slice);
    expect(typeNames(items)).toEqual(['checklistItem', 'checklistItem']);
    expect(items.map((item) => item.attrs.checked)).toEqual([true, false]);
    expect(items.map((item) => item.textContent.trim())).toEqual(['done', 'open']);
  });

  it('keeps the marks inside a pasted item', () => {
    const parsed = parseExternalHtml('<ul><li>plain <strong>bold</strong></li></ul>', schema);
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    const marks: string[] = [];
    parsed.slice.content.descendants((node) => {
      for (const mark of node.marks) marks.push(mark.type.name);
      return true;
    });
    expect(marks).toContain('strong');
  });

  it('walks through a layout table so the article inside it stays blocks', () => {
    const parsed = parseExternalHtml(
      '<table><tr><td><h1>Title</h1><p>Body.</p></td></tr></table>',
      schema,
    );
    if (parsed === null || parsed === 'too-large') throw new Error('expected a slice');
    const types = typeNames(childrenOf(parsed.slice));
    expect(types).toContain('heading');
    expect(types).not.toContain('table');
  });
});
