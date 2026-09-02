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
