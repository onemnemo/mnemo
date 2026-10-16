// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { parseMarkdownToBlocks } from '../../clipboard/markdown-blocks';
import { createEditorSchema } from '../schema';
import { createMarkdownSerializer } from './serialize-markdown';

const { schema, registry, inline } = createEditorSchema();
const md = createMarkdownSerializer(registry, inline);

function codeBlock(source: string, language: string, caption: string): PMNode {
  const line = schema.nodes.codeLine.create(null, source ? schema.text(source) : null);
  return schema.nodes.codeBlock.create({ sid: 'x', id: 'x', language, caption }, line);
}

const write = (...blocks: PMNode[]): string => md.document(schema.nodes.doc.create(null, blocks));

describe('a code block caption in markdown', () => {
  it('writes the caption in the fence line after the language', () => {
    expect(write(codeBlock('let x = 1;', 'ts', 'Figure one'))).toBe('```ts caption="Figure one"\nlet x = 1;\n```');
  });

  it('writes a block without a caption exactly as before', () => {
    expect(write(codeBlock('let x = 1;', 'ts', ''))).toBe('```ts\nlet x = 1;\n```');
    expect(write(codeBlock('plain', '', ''))).toBe('```\nplain\n```');
  });

  it('reads the caption back with the language and the source', () => {
    const [block] = parseMarkdownToBlocks('```ts caption="Figure one"\nlet x = 1;\n```');
    expect(block.type).toBe('Code');
    expect(block.payload).toEqual({ kind: 'code', language: 'ts', source: 'let x = 1;', caption: 'Figure one' });
  });

  it('reads a caption with no language', () => {
    const [block] = parseMarkdownToBlocks('```caption="Only a caption"\nx\n```');
    expect(block.payload).toEqual({ kind: 'code', language: '', source: 'x', caption: 'Only a caption' });
  });

  it('reads a fence without a caption with no caption key', () => {
    const [block] = parseMarkdownToBlocks('```ts\nx\n```');
    expect(block.payload).toEqual({ kind: 'code', language: 'ts', source: 'x' });
  });

  it.each(['say "hi"', 'C:\\temp\\x', 'use `ticks`', '\\u0060', 'ends with a backslash \\', 'a caption: with, punctuation'])(
    'round trips the caption %s',
    (caption) => {
      const markdown = write(codeBlock('body', 'js', caption));
      const [block] = parseMarkdownToBlocks(markdown);
      expect(block.type).toBe('Code');
      expect(block.payload).toMatchObject({ language: 'js', source: 'body', caption });
    },
  );

  it('keeps a caption beside a source that holds a fence of its own', () => {
    const source = 'a\n~~~\nb';
    const [block] = parseMarkdownToBlocks(write(codeBlock(source, 'md', 'nested')));
    expect(block.payload).toMatchObject({ language: 'md', source, caption: 'nested' });
  });
});
