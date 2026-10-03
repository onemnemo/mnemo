// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { MAX_BLOCKS, MAX_TABLE_COLUMNS, parseMarkdownToBlocks } from './markdown-blocks';
import { flattenDisplay } from '../model/spans';
import { isTextSpan, type Block } from '../model/types';

/** The one block a single-line input parses to. */
function one(markdown: string): Block {
  const blocks = parseMarkdownToBlocks(markdown);
  expect(blocks).toHaveLength(1);
  return blocks[0];
}

/** The flattened text of a block's inline content. */
const textOf = (block: Block) => flattenDisplay(block.spans);

describe('parseMarkdownToBlocks: nothing', () => {
  it('returns no blocks for empty or whitespace-only input', () => {
    expect(parseMarkdownToBlocks('')).toEqual([]);
    expect(parseMarkdownToBlocks('   \n\t\n  ')).toEqual([]);
  });

  it('mints every block with empty identity so the plugin assigns fresh ids', () => {
    for (const block of parseMarkdownToBlocks('# a\n- b\ntext')) {
      expect(block.id).toBe('');
      expect(block.sid).toBe('');
    }
  });
});

describe('parseMarkdownToBlocks: pipe tables', () => {
  const cellTexts = (table: Block): string[][] =>
    (table.children ?? []).map((row) => (row.children ?? []).map((cell) => textOf(cell)));

  it('reads a header, a delimiter and body rows into a table between its prose', () => {
    const blocks = parseMarkdownToBlocks(
      [
        'Intro paragraph.',
        '',
        '| Feature | Category | Test Status |',
        '| :--- | :--- | :--- |',
        '| Table Parsing | Core Editor | Success |',
        '| Selection | Clipboard | Active |',
        '',
        'Closing paragraph.',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Table', 'Text']);
    const table = blocks[1];
    expect(cellTexts(table)).toEqual([
      ['Feature', 'Category', 'Test Status'],
      ['Table Parsing', 'Core Editor', 'Success'],
      ['Selection', 'Clipboard', 'Active'],
    ]);
    expect(table.payload).toMatchObject({ kind: 'table', headerRows: [true, false, false] });
    expect((table.payload as { columnWidths: number[] }).columnWidths).toHaveLength(3);
    for (const row of table.children ?? []) {
      expect(row.type).toBe('TableRow');
      for (const cell of row.children ?? []) expect(cell.payload).toEqual({ kind: 'tableCell', fill: '' });
    }
  });

  it('keeps an escaped pipe literal and pads a short row to the widest', () => {
    const table = one('| a \\| b | c |\n|---|---|\n| only |');
    expect(cellTexts(table)).toEqual([
      ['a | b', 'c'],
      ['only', ''],
    ]);
  });

  it('keeps an escaped backslash before a pipe, the way the table writer escapes one', () => {
    const table = one('| back\\\\\\|slash | end\\\\ |\n| --- | --- |');
    expect(cellTexts(table)).toEqual([['back\\|slash', 'end\\']]);
  });

  it('reads a pipe inside inline code back as a pipe, the way the writer escapes it', () => {
    const table = one('| `c\\|d` | x |\n| --- | --- |');
    const code = table.children?.[0]?.children?.[0]?.spans[0];
    expect(code).toMatchObject({ kind: 'text', text: 'c|d', style: { code: true } });
  });

  it('accepts every GFM delimiter cell and tables without outer pipes', () => {
    expect(cellTexts(one('| a | b | c |\n|:-:|--:|-|\n| 1 | 2 | 3 |'))).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(cellTexts(one('a | b\n--- | ---\n1 | 2'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('refuses a delimiter row with a different number of cells, keeping every line', () => {
    const blocks = parseMarkdownToBlocks('| a | b |\n| --- |\n| 1 | 2 |');
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Text', 'Text']);
    expect(blocks.map(textOf)).toEqual(['| a | b |', '| --- |', '| 1 | 2 |']);
  });

  it('reads inline markdown inside a cell', () => {
    const table = one('| **bold** | x |\n| --- | --- |');
    const first = table.children?.[0]?.children?.[0];
    expect(first?.spans.some((span) => isTextSpan(span) && span.style.bold)).toBe(true);
  });

  it('leaves a line that merely starts with a pipe as text', () => {
    const block = one('| not a table');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toBe('| not a table');
  });

  it.each([
    ['# Heading | extra', 'Heading1', 'Heading | extra'],
    ['- item | x', 'BulletList', 'item | x'],
    ['1. item | x', 'NumberedList', 'item | x'],
    ['> quote | x', 'Quote', 'quote | x'],
  ])('ends the table at %s directly below it', (line, type, text) => {
    const blocks = parseMarkdownToBlocks(['| a | b |', '| --- | --- |', '| 1 | 2 |', line].join('\n'));
    expect(blocks.map((b) => b.type)).toEqual(['Table', type]);
    expect(cellTexts(blocks[0])).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(textOf(blocks[1])).toBe(text);
  });

  it('ends the table at a code fence directly below it', () => {
    const blocks = parseMarkdownToBlocks(['| a | b |', '| --- | --- |', '| 1 | 2 |', '```c | d', 'x', '```'].join('\n'));
    expect(blocks.map((b) => b.type)).toEqual(['Table', 'Code']);
    expect(blocks[0].children).toHaveLength(2);
  });

  it('keeps a table with a short and a wide row, padded to the widest', () => {
    const table = one('| a |\n| --- |\n| b | extra |\n| c');
    expect(cellTexts(table)).toEqual([
      ['a', ''],
      ['b', 'extra'],
      ['c', ''],
    ]);
  });
});

describe('parseMarkdownToBlocks: atomic blocks', () => {
  it('reads a divider, tolerating trailing whitespace', () => {
    expect(one('---').type).toBe('Divider');
    expect(one('---   ').type).toBe('Divider');
  });

  it('reads a page card only in the desktop `[[page:id]]` form', () => {
    const page = one('[[page:abc123]]');
    expect(page.type).toBe('Page');
    expect(page.payload).toEqual({ kind: 'page', referenceNoteId: 'abc123' });
  });

  it('leaves a bare `[[wikilink]]` as literal text, not a broken card', () => {
    const block = one('[[abc123]]');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toBe('[[abc123]]');
  });

  it('reads a single-line equation fence', () => {
    const eq = one('$$x^2$$');
    expect(eq.type).toBe('Equation');
    expect(eq.payload).toEqual({ kind: 'equation', latex: 'x^2' });
  });

  it('reads an opener with no closer as text rather than as a fence to the end', () => {
    const blocks = parseMarkdownToBlocks('before\n$$\nafter\n# Title');
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Text', 'Text', 'Heading1']);
    // The opener itself reads as an empty inline equation, which is what two dollars are to the
    // inline parser; what matters is that the lines after it are still their own blocks.
    expect(textOf(blocks[2])).toBe('after');
  });

  it('reads a multi-line equation fence and trims it', () => {
    const eq = one('$$\n  a + b\n$$');
    expect(eq.type).toBe('Equation');
    expect(eq.payload).toEqual({ kind: 'equation', latex: 'a + b' });
  });

  it('reads a lone image, unescaping the alt and stripping angle brackets', () => {
    // A backslash in the alt is unescaped and `<target>` brackets are stripped,
    // both matching the desktop reader. An alt containing a literal `]` is not
    // representable through the shared regex, on either side, so it is not tested.
    const img = one('![a\\\\b](<img/x.png>)');
    expect(img.type).toBe('Image');
    expect(img.payload).toEqual({
      kind: 'image',
      path: 'img/x.png',
      alt: 'a\\b',
      width: 0,
      align: 'left',
      crop: null,
    });
    expect(textOf(img)).toBe('a\\b');
  });
});

describe('parseMarkdownToBlocks: source fences', () => {
  it('reads a code fence with a language and stores the source verbatim', () => {
    const code = one('```ts\nconst x = 1;\nconst y = 2;\n```');
    expect(code.type).toBe('Code');
    expect(code.payload).toEqual({ kind: 'code', language: 'ts', source: 'const x = 1;\nconst y = 2;' });
    expect(textOf(code)).toBe('const x = 1;\nconst y = 2;');
  });

  it('leaves an unlabelled code fence without a language', () => {
    const code = one('```\nplain\n```');
    expect(code.type).toBe('Code');
    expect(code.payload).toMatchObject({ kind: 'code', language: '', source: 'plain' });
  });

  it('reads a sketch fence under both the desktop and port labels', () => {
    for (const fence of ['sketch', 'mnemo-sketch', 'SKETCH']) {
      const sketch = one('```' + fence + '\ndsl body\n```');
      expect(sketch.type).toBe('Sketch');
      expect(sketch.payload).toEqual({ kind: 'sketch', width: 0, align: 'left' });
      expect(textOf(sketch)).toBe('dsl body');
    }
  });

  it('keeps a fence that is never closed as text, rather than taking the rest of the paste', () => {
    const blocks = parseMarkdownToBlocks('```\nunterminated');
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Text']);
    expect(blocks.map(textOf)).toEqual(['```', 'unterminated']);
  });
});

describe('parseMarkdownToBlocks: prose lines', () => {
  it('reads all four heading levels, longest fence first', () => {
    expect(one('# a').type).toBe('Heading1');
    expect(one('## a').type).toBe('Heading2');
    expect(one('### a').type).toBe('Heading3');
    expect(one('#### a').type).toBe('Heading4');
  });

  it('does not read a hash without a trailing space as a heading', () => {
    const block = one('#notaheading');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toBe('#notaheading');
  });

  it('reads bullets under `-`, `*` and `+`', () => {
    expect(one('- a').type).toBe('BulletList');
    expect(one('* a').type).toBe('BulletList');
    expect(one('+ a').type).toBe('BulletList');
  });

  it('does not read `*emphasis*` as a bullet (no space after the marker)', () => {
    const block = one('*emphasis*');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toBe('emphasis');
    expect(block.spans.every((s) => !isTextSpan(s) || s.style.italic)).toBe(true);
  });

  it('reads checklist items, checked and unchecked', () => {
    const checked = one('- [x] done');
    expect(checked.type).toBe('Checklist');
    expect(checked.payload).toEqual({ kind: 'checklist', checked: true });
    expect(textOf(checked)).toBe('done');

    const open = one('- [ ] todo');
    expect(open.payload).toEqual({ kind: 'checklist', checked: false });
  });

  it('reads a numbered item that starts a list, and leaves a lone later number as text', () => {
    const item = one('1. first');
    expect(item.type).toBe('NumberedList');
    expect(item.payload).toEqual({ kind: 'empty' });
    expect(textOf(item)).toBe('first');
    expect(one('7. seventh').type).toBe('Text');
  });

  it('folds consecutive quote lines into one multi-line block', () => {
    const blocks = parseMarkdownToBlocks('> first\n> second\nafter');
    expect(blocks.map((b) => b.type)).toEqual(['Quote', 'Text']);
    expect(textOf(blocks[0])).toBe('first\nsecond');
    expect(textOf(blocks[1])).toBe('after');
  });
});

describe('parseMarkdownToBlocks: inline markdown inside blocks', () => {
  it('interprets inline styling in a plain-text line', () => {
    const block = one('a **bold** word');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toBe('a bold word');
    const bold = block.spans.find((s) => isTextSpan(s) && s.text === 'bold');
    expect(bold && isTextSpan(bold) && bold.style.bold).toBe(true);
  });

  it('interprets inline styling in heading and list content', () => {
    const heading = one('## *title*');
    expect(heading.type).toBe('Heading2');
    expect(heading.spans.some((s) => isTextSpan(s) && s.style.italic)).toBe(true);
  });

  it('keeps a fraction token as an atom in pasted text', () => {
    const block = one('one half is \\1/2');
    const fraction = block.spans.find((s) => s.kind === 'fraction');
    expect(fraction).toMatchObject({ kind: 'fraction', numerator: 1, denominator: 2 });
  });

  it('preserves leading indentation is left to the inline parser, keeping the raw line', () => {
    // The plain-text fallback passes the untrimmed line, matching the desktop.
    const block = one('    trailing thought');
    expect(block.type).toBe('Text');
    expect(textOf(block)).toContain('trailing thought');
  });
});

describe('parseMarkdownToBlocks: block-count cap', () => {
  // Generous timeout: parsing MAX_BLOCKS-plus lines is real synchronous work that runs well
  // inside vitest's 5000ms default alone, but not always under a full-suite run sharing the
  // machine with other heavy tests.
  it('folds the tail of a pathologically long paste into one verbatim block', { timeout: 20000 }, () => {
    const overflow = 50;
    const lineCount = MAX_BLOCKS + overflow;
    const blocks = parseMarkdownToBlocks(Array.from({ length: lineCount }, () => 'x').join('\n'));

    // The cap holds: the first MAX_BLOCKS lines are their own blocks, the rest is one.
    expect(blocks).toHaveLength(MAX_BLOCKS + 1);
    const tail = blocks[blocks.length - 1];
    expect(tail.type).toBe('Text');
    // No characters are dropped: the tail block carries every remaining line.
    expect(flattenDisplay(tail.spans)).toBe(Array.from({ length: overflow }, () => 'x').join('\n'));
  });

  it('does not engage the cap for an ordinary multi-line paste', () => {
    const blocks = parseMarkdownToBlocks(Array.from({ length: 200 }, (_, n) => `line ${n}`).join('\n'));
    expect(blocks).toHaveLength(200);
  });
});

describe('parseMarkdownToBlocks: whole documents', () => {
  it('parses a mixed document in order', () => {
    const blocks = parseMarkdownToBlocks(
      ['# Title', 'intro', '- one', '- two', '> quote', '---', '```js', 'code()', '```'].join('\n'),
    );
    expect(blocks.map((b) => b.type)).toEqual([
      'Heading1',
      'Text',
      'BulletList',
      'BulletList',
      'Quote',
      'Divider',
      'Code',
    ]);
    expect(blocks.map((b) => b.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('parseMarkdownToBlocks: nested lists', () => {
  /** The parsed blocks as an indented outline of type and text. */
  function outline(blocks: readonly Block[], depth = 0): string[] {
    const out: string[] = [];
    for (const block of blocks) {
      out.push(`${'  '.repeat(depth)}${block.type}:${textOf(block)}`);
      if (block.children) out.push(...outline(block.children, depth + 1));
    }
    return out;
  }

  it('nests a list line indented past the item above it', () => {
    const blocks = parseMarkdownToBlocks('- a\n  - b\n    - c\n  - d\n- e');
    expect(outline(blocks)).toEqual([
      'BulletList:a',
      '  BulletList:b',
      '    BulletList:c',
      '  BulletList:d',
      'BulletList:e',
    ]);
  });

  it('nests any list kind under any other, at whatever indent the writer chose', () => {
    // A tab reads as four columns: deeper than "done" at three, so it goes under
    // it, and no deeper than "star" at six, so it lands beside that one.
    const blocks = parseMarkdownToBlocks('1. one\n   - [x] done\n      * star\n\t1. tabbed');
    expect(outline(blocks)).toEqual([
      'NumberedList:one',
      '  Checklist:done',
      '    BulletList:star',
      '    NumberedList:tabbed',
    ]);
  });

  it('numbers children per container, so each list starts its order at zero', () => {
    const blocks = parseMarkdownToBlocks('- a\n  - b\n  - c\n- d');
    expect(blocks.map((b) => b.order)).toEqual([0, 1]);
    expect(blocks[0].children?.map((b) => b.order)).toEqual([0, 1]);
  });

  it('ends the nesting at anything that is not a list item', () => {
    const blocks = parseMarkdownToBlocks('- a\n  - b\nplain\n  - c');
    expect(outline(blocks)).toEqual(['BulletList:a', '  BulletList:b', 'Text:plain', 'BulletList:c']);
  });

  it('leaves a flat list flat, with no children arrays at all', () => {
    const blocks = parseMarkdownToBlocks('- a\n- b');
    expect(blocks.map((b) => b.children)).toEqual([null, null]);
  });

  // The same budget as the cap test above: thousands of inline parses share the machine with the suite.
  it('counts nested items toward the block cap', { timeout: 20000 }, () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_BLOCKS + 5; i++) lines.push(i % 2 === 0 ? '- a' : '  - b');
    const blocks = parseMarkdownToBlocks(lines.join('\n'));
    let total = 0;
    const count = (list: readonly Block[]): void => {
      for (const b of list) {
        total += 1;
        if (b.children) count(b.children);
      }
    };
    count(blocks);
    expect(total).toBe(MAX_BLOCKS + 1);
  });

  /** Every block in the tree, nested ones included. */
  const total = (list: readonly Block[]): number =>
    list.reduce((sum, b) => sum + 1 + (b.children ? total(b.children) : 0), 0);

  it('counts table rows and cells toward the cap and keeps the rows past it as text', { timeout: 20000 }, () => {
    const body = Array.from({ length: 4_000 }, (_, n) => `| r${n} | x | y |`);
    const blocks = parseMarkdownToBlocks(['| a | b | c |', '| --- | --- | --- |', ...body].join('\n'));

    expect(total(blocks)).toBeLessThanOrEqual(MAX_BLOCKS + 1);
    expect(blocks.map((b) => b.type)).toEqual(['Table', 'Text']);
    const rows = blocks[0].children ?? [];
    expect((blocks[0].payload as { headerRows: boolean[] }).headerRows).toHaveLength(rows.length);
    // The rows not taken, from the first one, are the text block, every character kept.
    expect(textOf(blocks[1])).toBe(body.slice(rows.length - 1).join('\n'));
  });

  it('keeps a table the cap leaves no room for as text, starting at its header', { timeout: 20000 }, () => {
    const filler = Array.from({ length: MAX_BLOCKS - 1 }, () => 'x');
    const blocks = parseMarkdownToBlocks([...filler, '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));

    expect(blocks).toHaveLength(MAX_BLOCKS);
    expect(textOf(blocks[blocks.length - 1])).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('caps the column count, so one wide row cannot pad every other', () => {
    const wide = Array.from({ length: 500 }, (_, n) => `c${n}`);
    const rows = Array.from({ length: 50 }, () => '| a | b |');
    const blocks = parseMarkdownToBlocks(['| h | i |', '| --- | --- |', `| ${wide.join(' | ')} |`, ...rows].join('\n'));

    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect((table.payload as { columnWidths: number[] }).columnWidths).toHaveLength(MAX_TABLE_COLUMNS);
    for (const row of table.children ?? []) expect(row.children).toHaveLength(MAX_TABLE_COLUMNS);
    // The cells past the cap join the last column rather than being dropped.
    const last = table.children?.[1]?.children?.[MAX_TABLE_COLUMNS - 1];
    expect(textOf(last as Block)).toBe(wide.slice(MAX_TABLE_COLUMNS - 1).join(' | '));
  });
});

describe('parseMarkdownToBlocks: hard breaks', () => {
  it('folds a line ending in a hard break into the block it continues', () => {
    expect(textOf(one('one\\\ntwo'))).toBe('one\ntwo');
    expect(textOf(one('# a\\\nb'))).toBe('a\nb');
    expect(textOf(one('- x\\\ny\\\nz'))).toBe('x\ny\nz');
  });

  it('reads an even run of trailing backslashes as literal text, not a break', () => {
    const blocks = parseMarkdownToBlocks('path\\\\\nnext');
    expect(blocks.map(textOf)).toEqual(['path\\', 'next']);
    expect(parseMarkdownToBlocks('odd\\\\\\\nnext').map(textOf)).toEqual(['odd\\\nnext']);
  });

  it('leaves a backslash at the end of a code or equation line alone', () => {
    const code = one('```\nline\\\n```');
    expect(code.type).toBe('Code');
    expect(textOf(code)).toBe('line\\');

    const blocks = parseMarkdownToBlocks('$$\na \\\\\\\n$$\nafter');
    expect(blocks.map((b) => b.type)).toEqual(['Equation', 'Text']);
    expect(blocks[0].payload).toEqual({ kind: 'equation', latex: 'a \\\\\\' });
  });

  it('keeps a hard break at the very end of the paste as a trailing newline', () => {
    expect(textOf(one('tail\\'))).toBe('tail\\');
    expect(textOf(one('tail\\\n'))).toBe('tail\n');
  });
});
