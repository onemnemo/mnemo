// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { asBlockSchema, createEditorSchema } from '../schema';
import { createMarkdownSerializer } from './serialize-markdown';
import { serializeInlineMarkdown } from '../../model/markdown-serialize';
import { defaultTextStyle, type InlineSpan } from '../../model/types';

const { schema, registry, inline } = createEditorSchema();
const blockSchema = asBlockSchema(schema);
const md = createMarkdownSerializer(registry, inline);

const style = (over: Partial<typeof defaultTextStyle> = {}) => ({ ...defaultTextStyle, ...over });
const text = (t: string, over: Partial<typeof defaultTextStyle> = {}): InlineSpan => ({
  kind: 'text',
  text: t,
  style: style(over),
});
const line = (...spans: InlineSpan[]): PMNode =>
  schema.nodes.line.create(null, inline.toInline(spans.length ? spans : [text('')], blockSchema));
const block = (nodeName: string, attrs: Record<string, unknown>, ...spans: InlineSpan[]): PMNode =>
  schema.nodes[nodeName].create({ sid: 'x', id: 'x', ...attrs }, line(...spans));
const doc = (...blocks: PMNode[]): PMNode => schema.nodes.doc.create(null, blocks);

describe('serializeInlineMarkdown', () => {
  it('wraps each representable style in its markdown delimiters', () => {
    expect(serializeInlineMarkdown([text('b', { bold: true })])).toBe('**b**');
    expect(serializeInlineMarkdown([text('i', { italic: true })])).toBe('*i*');
    expect(serializeInlineMarkdown([text('bi', { bold: true, italic: true })])).toBe('***bi***');
    expect(serializeInlineMarkdown([text('s', { strikethrough: true })])).toBe('~~s~~');
    expect(serializeInlineMarkdown([text('l', { linkUrl: 'https://x.test' })])).toBe(
      '[l](https://x.test)',
    );
  });

  it('drops styles markdown cannot express (underline, highlight, sub/sup, colour)', () => {
    expect(serializeInlineMarkdown([text('u', { underline: true })])).toBe('u');
    expect(serializeInlineMarkdown([text('h', { highlight: true })])).toBe('h');
    expect(serializeInlineMarkdown([text('x', { subscript: true })])).toBe('x');
    expect(serializeInlineMarkdown([text('c', { foregroundColor: '#f00' })])).toBe('c');
  });

  it('fences a code span past its longest internal backtick run, padding when needed', () => {
    expect(serializeInlineMarkdown([text('plain', { code: true })])).toBe('`plain`');
    expect(serializeInlineMarkdown([text('a`b', { code: true })])).toBe('`` a`b ``');
    expect(serializeInlineMarkdown([text('a``b', { code: true })])).toBe('``` a``b ```');
  });

  it('escapes markdown control characters but leaves an embedded image intact', () => {
    expect(serializeInlineMarkdown([text('a*b_c')])).toBe('a\\*b\\_c');
    expect(serializeInlineMarkdown([text('see ![alt](p.png) here')])).toBe('see ![alt](p.png) here');
  });

  it('escapes a link destination', () => {
    expect(serializeInlineMarkdown([text('t', { linkUrl: 'a)b' })])).toBe('[t](a\\)b)');
  });

  it('renders inline atoms as their Mnemo markdown tokens', () => {
    expect(serializeInlineMarkdown([{ kind: 'equation', latex: 'mc^2', style: style() }])).toBe('$mc^2$');
    expect(
      serializeInlineMarkdown([{ kind: 'fraction', numerator: 1, denominator: 2, style: style() }]),
    ).toBe('\\1/2');
  });
});

describe('createMarkdownSerializer', () => {
  it('renders each block type in its markdown form', () => {
    expect(md.document(doc(block('paragraph', {}, text('hello'))))).toBe('hello');
    expect(md.document(doc(block('heading', { level: 2 }, text('Title'))))).toBe('## Title');
    expect(md.document(doc(block('bulletItem', {}, text('item'))))).toBe('- item');
    expect(md.document(doc(block('checklistItem', { checked: true }, text('done'))))).toBe('- [x] done');
    expect(md.document(doc(block('checklistItem', { checked: false }, text('todo'))))).toBe('- [ ] todo');
    expect(md.document(doc(block('quote', {}, text('q'))))).toBe('> q');
    expect(md.document(doc(block('divider', {})))).toBe('---');
    expect(md.document(doc(block('image', { path: 'img/a.png' }, text('caption'))))).toBe(
      '![caption](img/a.png)',
    );
    expect(md.document(doc(block('equationBlock', { latex: 'x^2' })))).toBe('$$\nx^2\n$$');
  });

  it('renders a callout as a quote carrying its tone and glyph', () => {
    expect(md.document(doc(block('callout', { emoji: '💡', tone: 'note' }, text('heads up'))))).toBe(
      '> [!note 💡] heads up',
    );
    // A glyph-less callout still names its tone, otherwise it reads back as a quote.
    expect(md.document(doc(block('callout', { emoji: '', tone: 'warn' }, text('careful'))))).toBe(
      '> [!warn] careful',
    );
    // Every line carries its own marker; without it the tail re-imports as
    // separate paragraphs sitting outside the callout.
    expect(md.document(doc(block('callout', { emoji: '💡', tone: 'note' }, text('one\ntwo'))))).toBe(
      '> [!note 💡] one\n> two',
    );
  });

  it('renders a numbered item with a literal 1. (markdown renumbers on parse)', () => {
    expect(md.document(doc(block('numberedItem', {}, text('one')), block('numberedItem', {}, text('two'))))).toBe(
      '1. one\n1. two',
    );
  });

  it('joins top-level blocks one per line and trims the trailing newline', () => {
    const out = md.document(
      doc(block('heading', { level: 1 }, text('T')), block('paragraph', {}, text('body'))),
    );
    expect(out).toBe('# T\nbody');
  });

  it('flattens a two-column row to its cells blocks in document order', () => {
    const cell = (txt: string) =>
      schema.nodes.columnGroup.create({ sid: 'c', id: 'c' }, [line(), block('paragraph', {}, text(txt))]);
    const twoColumn = schema.nodes.twoColumn.create({ sid: 't', id: 't', splitRatio: 0.5 }, [
      line(),
      cell('left'),
      cell('right'),
    ]);
    expect(md.document(doc(twoColumn))).toBe('left\nright');
  });

  it('serializes a block caption and inline atoms through the real inline mapper', () => {
    const para = block('paragraph', {}, text('e='), { kind: 'equation', latex: 'mc^2', style: style() }, text(' done'));
    expect(md.document(doc(para))).toBe('e=$mc^2$ done');
  });
});
