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
});
