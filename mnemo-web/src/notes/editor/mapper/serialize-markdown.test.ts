// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { asBlockSchema, createEditorSchema } from '../schema';
import { createMarkdownSerializer } from './serialize-markdown';
import { parseMarkdownToBlocks } from '../../clipboard/markdown-blocks';
import { serializeInlineMarkdown } from '../../model/markdown-serialize';
import { defaultTextStyle, type InlineSpan } from '../../model/types';

const { schema, registry, inline } = createEditorSchema();
const blockSchema = asBlockSchema(schema);
const md = createMarkdownSerializer(registry, inline);

/** Read back as a markdown document, the way the host reads an exported file. */
const readBack = (markdown: string) => parseMarkdownToBlocks(`# Doc\n\n${markdown}`).slice(1);

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

  it('writes a newline inside a span as a CommonMark hard break', () => {
    // A trailing backslash rather than a bare newline, so a reader that splits on
    // physical lines can tell a soft break from the next block. A literal backslash
    // before the break escapes to two, which keeps the run odd and the break readable.
    expect(serializeInlineMarkdown([text('one\ntwo')])).toBe('one\\\ntwo');
    expect(serializeInlineMarkdown([text('end\\\nnext')])).toBe('end\\\\\\\nnext');
    expect(serializeInlineMarkdown([text('b\nold', { bold: true })])).toBe('**b\\\nold**');
  });

  it('writes nothing for an empty equation chip, whose token would be a fence', () => {
    expect(serializeInlineMarkdown([text('a'), { kind: 'equation', latex: '', style: style() }, text('b')])).toBe('ab');
    expect(serializeInlineMarkdown([{ kind: 'equation', latex: '', style: style() }])).toBe('');
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
    // The glyph is whatever the picker wrote, not one of the two the slash menu
    // inserts, so a multi-codepoint sequence has to survive the head intact.
    expect(md.document(doc(block('callout', { emoji: '🧑‍🚀', tone: 'note' }, text('picked'))))).toBe(
      '> [!note 🧑‍🚀] picked',
    );
    // A glyph-less callout still names its tone, otherwise it reads back as a quote.
    expect(md.document(doc(block('callout', { emoji: '', tone: 'warn' }, text('careful'))))).toBe(
      '> [!warn] careful',
    );
    // Every line carries its own marker; without it the tail re-imports as
    // separate paragraphs sitting outside the callout.
    expect(md.document(doc(block('callout', { emoji: '💡', tone: 'note' }, text('one\ntwo'))))).toBe(
      '> [!note 💡] one\\\n> two',
    );
  });

  it('writes each numbered item as the number it shows', () => {
    expect(md.document(doc(block('numberedItem', {}, text('one')), block('numberedItem', {}, text('two'))))).toBe(
      '1. one\n2. two',
    );
  });

  it('counts a run on from the start its first item stores', () => {
    const out = md.document(
      doc(
        block('numberedItem', { meta: { listStart: 8 } }, text('eight')),
        block('numberedItem', { meta: { listStart: 2 } }, text('nine')),
        block('numberedItem', {}, text('ten')),
      ),
    );
    expect(out).toBe('8. eight\n9. nine\n10. ten');
    expect(readBack(out).map((b) => b.meta)).toEqual([{ listStart: 8 }, {}, {}]);
  });

  it('never reads the per-item numbers older imports stored', () => {
    const out = md.document(
      doc(
        block('numberedItem', { meta: { listNumberIndex: 8, listNumber: '8.' } }, text('a')),
        block('numberedItem', { meta: { listNumberIndex: 9 } }, text('b')),
      ),
    );
    expect(out).toBe('1. a\n2. b');
  });

  it('keeps a start of 0 at decimal depth, and counts from 1 under a letter label', () => {
    const bullet = schema.nodes.bulletItem.create({ sid: 'b', id: 'b' }, [
      line(text('b')),
      block('numberedItem', { meta: { listStart: 0 } }, text('x')),
    ]);
    const out = md.document(doc(block('numberedItem', { meta: { listStart: 0 } }, text('zero')), bullet));
    expect(out).toBe('0. zero\n- b\n  1. x');
    expect(readBack(out)[0].meta).toEqual({ listStart: 0 });
  });

  it('puts a blank line above a run that starts past one, so a reader does not fold it into the line above', () => {
    const bullet = schema.nodes.bulletItem.create({ sid: 'b', id: 'b' }, [
      line(text('a')),
      block('numberedItem', { meta: { listStart: 3 } }, text('x')),
    ]);
    const out = md.document(doc(bullet, block('numberedItem', { meta: { listStart: 5 } }, text('five'))));
    expect(out).toBe('- a\n\n  3. x\n\n5. five');
    const back = readBack(out);
    expect(back.map((b) => b.type)).toEqual(['BulletList', 'NumberedList']);
    expect(back[0].children?.map((b) => b.meta)).toEqual([{ listStart: 3 }]);
    expect(back[1].meta).toEqual({ listStart: 5 });
  });

  it('indents a sub-list to the width of a two digit marker', () => {
    const ten = schema.nodes.numberedItem.create({ sid: 't', id: 't', meta: { listStart: 10 } }, [
      line(text('ten')),
      block('bulletItem', {}, text('sub')),
    ]);
    expect(md.document(doc(ten))).toBe('10. ten\n    - sub');
  });

  it('escapes a paragraph that would read as a list item, so it reads back as text', () => {
    for (const value of ['2. oktober', '1. oktober', '2026. was a year']) {
      const out = md.document(doc(block('heading', { level: 1 }, text('Plan')), block('paragraph', {}, text(value))));
      const dot = value.indexOf('.');
      expect(out.endsWith(`\n\n${value.slice(0, dot)}\\${value.slice(dot)}`)).toBe(true);
      const back = parseMarkdownToBlocks(out);
      expect(back.map((b) => b.type)).toEqual(['Heading1', 'Text']);
      expect(back[1].spans.map((span) => ('text' in span ? span.text : '')).join('')).toBe(value);
    }
  });

  it('joins top-level blocks with a blank line and trims the trailing newline', () => {
    const out = md.document(
      doc(block('heading', { level: 1 }, text('T')), block('paragraph', {}, text('body'))),
    );
    expect(out).toBe('# T\n\nbody');
  });

  it('flattens a two-column row to its cells blocks in document order', () => {
    const cell = (txt: string) =>
      schema.nodes.columnGroup.create({ sid: 'c', id: 'c' }, [line(), block('paragraph', {}, text(txt))]);
    const twoColumn = schema.nodes.twoColumn.create({ sid: 't', id: 't', splitRatio: 0.5 }, [
      line(),
      cell('left'),
      cell('right'),
    ]);
    expect(md.document(doc(twoColumn))).toBe('left\n\nright');
  });

  it('serializes a block caption and inline atoms through the real inline mapper', () => {
    const para = block('paragraph', {}, text('e='), { kind: 'equation', latex: 'mc^2', style: style() }, text(' done'));
    expect(md.document(doc(para))).toBe('e=$mc^2$ done');
  });
});

describe('CommonMark block separation', () => {
  it('puts a blank line between blocks and keeps a list run tight, as the host exporter does', () => {
    const out = md.document(
      doc(
        block('heading', { level: 1 }, text('Title')),
        block('paragraph', {}, text('intro')),
        block('bulletItem', {}, text('a')),
        block('checklistItem', { checked: false }, text('b')),
        block('numberedItem', {}, text('c')),
        block('quote', {}, text('q')),
        block('divider', {}),
      ),
    );
    expect(out).toBe('# Title\n\nintro\n\n- a\n- [ ] b\n1. c\n\n> q\n\n---');
  });

  it('leaves an empty paragraph blank in plain text, and keeps a literal &nbsp; its text', () => {
    const plain = createMarkdownSerializer(registry, inline, { emptyParagraph: 'blank' });
    const d = doc(block('paragraph', {}, text('a')), block('paragraph', {}), block('paragraph', {}, text('&nbsp;')));
    const out = plain.document(d);
    expect(out).toBe('a\n\n\n\n\\&nbsp;');
    expect(parseMarkdownToBlocks(out).map((b) => b.spans.map((s) => (s.kind === 'text' ? s.text : '')).join(''))).toEqual([
      'a',
      '&nbsp;',
    ]);
  });

  it('writes an empty paragraph as &nbsp; and escapes one that literally says it', () => {
    expect(md.document(doc(block('paragraph', {}, text('a')), block('paragraph', {}), block('paragraph', {}, text('b'))))).toBe(
      'a\n\n&nbsp;\n\nb',
    );
    expect(md.document(doc(block('paragraph', {}, text('&nbsp;'))))).toBe('\\&nbsp;');
  });

  it('reads back as the same blocks, empty paragraphs included', () => {
    const textOf = (b: { spans: InlineSpan[] }) => b.spans.map((s) => (s.kind === 'text' ? s.text : '')).join('');
    const out = md.document(
      doc(
        block('paragraph', {}, text('one')),
        block('paragraph', {}),
        block('paragraph', {}, text('&nbsp;')),
        block('bulletItem', {}, text('x')),
        block('bulletItem', {}, text('y')),
        block('paragraph', {}, text('two')),
      ),
    );
    const blocks = readBack(out);
    expect(blocks.map((b) => `${b.type}:${textOf(b)}`)).toEqual([
      'Text:one',
      'Text:',
      'Text:&nbsp;',
      'BulletList:x',
      'BulletList:y',
      'Text:two',
    ]);
  });

  it('keeps a column row in the run, separated like any other block', () => {
    const cell = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: 'c', id: 'c' }, [line(), ...blocks]);
    const twoColumn = schema.nodes.twoColumn.create({ sid: 't', id: 't', splitRatio: 0.5 }, [
      line(),
      cell(block('bulletItem', {}, text('l1')), block('bulletItem', {}, text('l2'))),
      cell(block('paragraph', {}, text('right'))),
    ]);
    expect(md.document(doc(block('bulletItem', {}, text('before')), twoColumn))).toBe('- before\n- l1\n- l2\n\nright');
  });
});

describe('nested lists', () => {
  const item = (nodeName: string, t: string, ...children: PMNode[]): PMNode =>
    schema.nodes[nodeName].create(
      { sid: 'x', id: 'x', ...(nodeName === 'checklistItem' ? { checked: true } : {}) },
      [line(text(t)), ...children],
    );

  it('indents a sub-list two spaces under a bullet and three under a numbered item', () => {
    const d = doc(
      item('bulletItem', 'a', item('bulletItem', 'b', item('numberedItem', 'c'))),
      item('numberedItem', 'd', item('bulletItem', 'e')),
      item('checklistItem', 'f', item('checklistItem', 'g')),
    );
    expect(md.document(d)).toBe(
      ['- a', '  - b', '    1. c', '1. d', '   - e', '- [x] f', '  - [x] g'].join('\n'),
    );
  });

  it('reads back through the block parser as the same tree', () => {
    const d = doc(item('bulletItem', 'a', item('numberedItem', 'b', item('bulletItem', 'c'))), item('bulletItem', 'd'));
    const blocks = readBack(md.document(d));
    expect(blocks.map((b) => b.type)).toEqual(['BulletList', 'BulletList']);
    expect(blocks[0].children?.map((b) => b.type)).toEqual(['NumberedList']);
    expect(blocks[0].children?.[0].children?.map((b) => b.type)).toEqual(['BulletList']);
  });
});

describe('soft breaks', () => {
  const textOf = (b: { spans: InlineSpan[] }) =>
    b.spans.map((s) => (s.kind === 'text' ? s.text : '')).join('');

  it('survive a round trip in every block that can hold one', () => {
    const d = doc(
      block('paragraph', {}, text('one\ntwo')),
      block('heading', { level: 2 }, text('a\nb')),
      block('bulletItem', {}, text('x\ny')),
      block('numberedItem', {}, text('n\nm')),
      block('checklistItem', { checked: true }, text('c\nd')),
      block('quote', {}, text('q\nr')),
    );

    const out = md.document(d);
    expect(out).toBe(
      ['one\\', 'two', '', '## a\\', 'b', '', '- x\\', 'y', '1. n\\', 'm', '- [x] c\\', 'd', '', '> q\\', '> r'].join('\n'),
    );

    const blocks = readBack(out);
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Heading2', 'BulletList', 'NumberedList', 'Checklist', 'Quote']);
    expect(blocks.map(textOf)).toEqual(['one\ntwo', 'a\nb', 'x\ny', 'n\nm', 'c\nd', 'q\nr']);
  });

  it('survive at the end of a block, and an empty line inside one', () => {
    const d = doc(block('paragraph', {}, text('tail\n')), block('quote', {}, text('a\n\nb')), block('paragraph', {}, text('after')));

    const out = md.document(d);
    expect(out).toBe(['tail\\', '', '', '> a\\', '> \\', '> b', '', 'after'].join('\n'));

    const blocks = readBack(out);
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Quote', 'Text']);
    expect(blocks.map(textOf)).toEqual(['tail\n', 'a\n\nb', 'after']);
  });

  it('keep a block ending in a literal backslash apart from the block after it', () => {
    const out = md.document(doc(block('paragraph', {}, text('path\\')), block('paragraph', {}, text('next'))));
    expect(out).toBe('path\\\\\n\nnext');

    const blocks = readBack(out);
    expect(blocks.map(textOf)).toEqual(['path\\', 'next']);
  });

  it('survive inside a nested list item', () => {
    const child = schema.nodes.bulletItem.create({ sid: 'c', id: 'c' }, [line(text('in\nner'))]);
    const parent = schema.nodes.bulletItem.create({ sid: 'p', id: 'p' }, [line(text('outer')), child]);

    const out = md.document(doc(parent));
    expect(out).toBe('- outer\n  - in\\\n  ner');

    const blocks = readBack(out);
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0].children![0])).toBe('in\nner');
  });

  it('are dropped from an image caption, which markdown keeps on one line', () => {
    const out = md.document(doc(block('image', { path: 'p.png' }, text('top\nbottom'))));
    expect(out).toBe('![top bottom](p.png)');
    expect(readBack(out).map((b) => b.type)).toEqual(['Image']);
  });

  it('leave a caption its markers, since the reference is not a line of text', () => {
    // The caption is written as the host writes it: plain text with only the backslash and
    // the closing bracket escaped, so a caption that starts with a dash or a number reads back
    // as typed rather than with a stray backslash. (A bracket in a caption is its own case:
    // neither reader's reference grammar admits one yet.)
    const out = md.document(doc(block('image', { path: 'p.png' }, text('- 1. a\\c *x*'))));
    expect(out).toBe('![- 1. a\\\\c *x*](p.png)');
    const [only] = readBack(out);
    expect(only.type).toBe('Image');
    expect(textOf(only)).toBe('- 1. a\\c *x*');
  });

  it('keep a continuation line that looks like a block inside its block', () => {
    // The folded text is handed to a document parser, so a line-leading marker is escaped
    // or it would end the paragraph and start a list, a heading, a quote or a rule.
    const texts = ['Hello\n- item', 'Hello\n# Title', 'Hello\n> quoted', 'Hello\n1. first', 'Hello\n---', 'Hello\n<div>', 'Hello\n$$'];
    const d = doc(...texts.map((t) => block('paragraph', {}, text(t))));

    const out = md.document(d);
    expect(out.split('\n')[1]).toBe('\\- item');
    expect(out.split('\n')[10]).toBe('1\\. first');

    const blocks = readBack(out);
    expect(blocks.map((b) => b.type)).toEqual(texts.map(() => 'Text'));
    expect(blocks.map(textOf)).toEqual(texts);
  });

  it('keep a marker behind leading blanks inside its block', () => {
    // A reader trims a line before it looks for a marker, so the escape lands on the first
    // non-blank character, on a folded line and on the first line of a block alike.
    const texts = ['Hello\n - item', 'Hello\n   # Title', 'Hello\n ---', 'Hello\n\t> quoted', ' - item', '  1) first'];
    const d = doc(...texts.map((t) => block('paragraph', {}, text(t))));

    const out = md.document(d);
    expect(out.split('\n')[1]).toBe(' \\- item');
    expect(out.split('\n')[12]).toBe(' \\- item');

    const blocks = readBack(out);
    expect(blocks.map((b) => b.type)).toEqual(texts.map(() => 'Text'));
    expect(blocks.map(textOf)).toEqual(['Hello\n- item', 'Hello\n# Title', 'Hello\n---', 'Hello\n> quoted', '- item', '1) first']);
  });

  it('keep a ten digit number and a dot a text block, as the writer leaves it unescaped', () => {
    // CommonMark bounds an ordered marker at nine digits; the readers agree with the writer.
    const out = md.document(doc(block('paragraph', {}, text('1234567890. first'))));
    expect(out).toBe('1234567890. first');
    const [only] = readBack(out);
    expect(only.type).toBe('Text');
    expect(textOf(only)).toBe('1234567890. first');
  });

  it('keep bold across a break that is followed by a marker', () => {
    const out = md.document(doc(block('paragraph', {}, text('a\n- b', { bold: true }))));
    expect(out).toBe('**a\\\n\\- b**');

    const [only] = readBack(out);
    expect(only.spans).toEqual([text('a\n- b', { bold: true })]);
  });

  it('keep a text block that starts like a block a text block', () => {
    const out = md.document(doc(block('paragraph', {}, text('- not a bullet')), block('paragraph', {}, text('# not a heading'))));
    expect(out).toBe('\\- not a bullet\n\n\\# not a heading');

    const blocks = readBack(out);
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Text']);
    expect(blocks.map(textOf)).toEqual(['- not a bullet', '# not a heading']);
  });

  it('survive as the last thing in the document', () => {
    // The document writer trims the block terminator and nothing else, so the last block's
    // marker keeps its newline and reads back as a break rather than a literal backslash.
    const d = doc(block('paragraph', {}, text('tail\n')));
    expect(md.document(d)).toBe('tail\\\n');
    expect(readBack(md.document(d)).map(textOf)).toEqual(['tail\n']);

    const two = doc(block('paragraph', {}, text('tail\n\n')));
    expect(md.document(two)).toBe('tail\\\n\\\n');
    expect(readBack(md.document(two)).map(textOf)).toEqual(['tail\n\n']);

    const heading = doc(block('heading', { level: 1 }, text('tail\n')));
    expect(md.document(heading)).toBe('# tail\\\n');
    expect(readBack(md.document(heading)).map(textOf)).toEqual(['tail\n']);
  });

  it('survive inside inline code as a break between two spans', () => {
    // A backslash is literal inside backticks, so the span is closed around the break; the
    // newline itself comes back unstyled, which is the one thing markdown cannot say.
    const out = md.document(doc(block('paragraph', {}, text('a\nb', { code: true }))));
    expect(out).toBe('`a`\\\n`b`');

    const [only] = readBack(out);
    expect(only.spans).toEqual([text('a', { code: true }), text('\n'), text('b', { code: true })]);
  });
});
