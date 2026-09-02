// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { MAX_BLOCKS, parseMarkdownToBlocks } from './markdown-blocks';
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

  it('defaults an unlabelled code fence to csharp, matching the desktop', () => {
    const code = one('```\nplain\n```');
    expect(code.type).toBe('Code');
    expect(code.payload).toMatchObject({ kind: 'code', language: 'csharp', source: 'plain' });
  });

  it('reads a sketch fence under both the desktop and port labels', () => {
    for (const fence of ['sketch', 'mnemo-sketch', 'SKETCH']) {
      const sketch = one('```' + fence + '\ndsl body\n```');
      expect(sketch.type).toBe('Sketch');
      expect(sketch.payload).toEqual({ kind: 'sketch', width: 0, align: 'left' });
      expect(textOf(sketch)).toBe('dsl body');
    }
  });

  it('consumes to end of input when a fence is never closed', () => {
    const code = one('```\nunterminated');
    expect(code.type).toBe('Code');
    expect(code.payload).toMatchObject({ source: 'unterminated' });
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

  it('reads a numbered item regardless of the stored index', () => {
    const item = one('7. seventh');
    expect(item.type).toBe('NumberedList');
    expect(item.payload).toEqual({ kind: 'empty' });
    expect(textOf(item)).toBe('seventh');
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
  it('folds the tail of a pathologically long paste into one verbatim block', () => {
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
    const blocks = parseMarkdownToBlocks('1. one\n   - [x] done\n      * star\n\t2. tabbed');
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

  it('counts nested items toward the block cap', () => {
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
});
