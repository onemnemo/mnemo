// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseMarkdownToBlocks } from './markdown-blocks';
import { flattenDisplay } from '../model/spans';
import { isTextSpan, type Block } from '../model/types';

const textOf = (block: Block) => flattenDisplay(block.spans);
const read = (text: string) => parseMarkdownToBlocks(text).map((b) => `${b.type}:${textOf(b)}`);

/** The fastest of two parses, so one stall on a loaded machine does not count. */
function parseMs(text: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 2; run++) {
    const started = performance.now();
    parseMarkdownToBlocks(text);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

/**
 * Asserts the parse grows linearly: four times the input stays well under the sixteen times
 * a quadratic parse would take. A ratio holds on a slow or loaded machine where a fixed bound does
 * not; the floor keeps a quarter that runs in a few milliseconds from turning noise into a ratio,
 * so each input is sized for a quarter well above it. The absolute cap catches a slowdown that
 * keeps the ratio.
 */
function expectLinear(input: (size: number) => string, size: number): void {
  const quarter = parseMs(input(size / 4));
  const whole = parseMs(input(size));
  expect(whole / Math.max(25, quarter)).toBeLessThan(10);
  expect(whole).toBeLessThan(5000);
}

describe('parseMarkdownToBlocks: blank lines', () => {
  it('starts a block at a blank line and never makes one of it', () => {
    expect(read('one\n\n\n\ntwo')).toEqual(['Text:one', 'Text:two']);
    expect(read('\n\nonly\n\n')).toEqual(['Text:only']);
  });

  it('keeps the one block per line reading when no blank line separates anything', () => {
    expect(read('one\ntwo\nthree')).toEqual(['Text:one', 'Text:two', 'Text:three']);
    expect(read('# Title\nintro\nmore')).toEqual(['Heading1:Title', 'Text:intro', 'Text:more']);
  });

  it('counts a blank line inside either kind of fence as part of the code', () => {
    expect(read('a\nb\n```\nx\n\ny\n```')).toEqual(['Text:a', 'Text:b', 'Code:x\n\ny']);
    expect(read('a\nb\n~~~\nx\n\ny\n~~~')).toEqual(['Text:a', 'Text:b', 'Code:x\n\ny']);
  });

  it('reads a line holding only &nbsp; as an empty paragraph', () => {
    expect(read('a\n\n&nbsp;\n\nb')).toEqual(['Text:a', 'Text:', 'Text:b']);
    expect(read('a\n&nbsp;\nb')).toEqual(['Text:a', 'Text:', 'Text:b']);
    expect(read('# H\n\n&nbsp;\n\n- x')).toEqual(['Heading1:H', 'Text:', 'BulletList:x']);
    expect(read('\\&nbsp;')).toEqual(['Text:&nbsp;']);
  });
});

describe('parseMarkdownToBlocks: each block reads by its own shape', () => {
  it('keeps an email signature in shape and makes its list a real list', () => {
    const email = [
      'Hi Tom,',
      '',
      'Can you pick up:',
      '- milk',
      '- eggs',
      '',
      'Best regards,',
      'Torstein',
      'Storgata 1',
      '0155 Oslo',
    ].join('\n');
    expect(read(email)).toEqual([
      'Text:Hi Tom,',
      'Text:Can you pick up:',
      'BulletList:milk',
      'BulletList:eggs',
      'Text:Best regards,\nTorstein\nStorgata 1\n0155 Oslo',
    ]);
  });

  it('keeps the lines of a quoted reply apart', () => {
    expect(read('Sounds good.\n\n> On Friday Tom wrote:\n> see you\n> Monday')).toEqual([
      'Text:Sounds good.',
      'Quote:On Friday Tom wrote:\nsee you\nMonday',
    ]);
  });

  it('keeps a poem and an address in shape', () => {
    expect(read('Roses are red\nViolets are blue\n\nSugar is sweet\nAnd so are you')).toEqual([
      'Text:Roses are red\nViolets are blue',
      'Text:Sugar is sweet\nAnd so are you',
    ]);
  });

  it('keeps plain text exactly as typed, markup and indentation included', () => {
    const typed = '<div>\n2*3*4 and **this**\n    indented\ntrailing\\';
    expect(read(`${typed}\n\nnext`)).toEqual([`Text:${typed}`, 'Text:next']);
  });

  it('keeps a paragraph break after a line ending in a backslash', () => {
    for (const eol of ['\n', '\r\n']) {
      const pasted = ['Saved to C:\\Backup\\', '', 'Then restart the app', 'and log in again.'].join(eol);
      expect(read(pasted)).toEqual(['Text:Saved to C:\\Backup\\', 'Text:Then restart the app\nand log in again.']);
    }
  });

  it('keeps every word around a fence that never closes', () => {
    expect(read('Hi\n\n``` to start code\n\nThanks')).toEqual(['Text:Hi', 'Text:``` to start code', 'Text:Thanks']);
  });

  it('reads hundreds of thousands of fence openers in linear time', { timeout: 60000 }, () => {
    const input = (size: number) => 'a\n\nb\n' + '```a\n'.repeat(size);
    expectLinear(input, 320000);
    const blocks = parseMarkdownToBlocks(input(320000));
    expect(blocks.map((b) => b.type)).toEqual(['Text', 'Text']);
  });

  it('joins tens of thousands of wrapped lines after a heading in linear time', { timeout: 60000 }, () => {
    const input = (size: number) =>
      `# T\n\n${Array.from({ length: size }, (_, n) => `line ${String(n)} of a long `).join('\n')}`;
    expectLinear(input, 32000);
    const blocks = parseMarkdownToBlocks(input(32000));
    // A paragraph takes at most a thousand lines, so this one arrives in thirty two.
    expect(blocks.map((b) => b.type)).toEqual(['Heading1', ...Array<string>(32).fill('Text')]);
    expect(textOf(blocks[1]).startsWith('line 0 of a long line 1 of')).toBe(true);
    expect(textOf(blocks[2]).startsWith('line 1000 of a long')).toBe(true);
  });

  it('reads tens of thousands of hard broken lines in linear time', { timeout: 60000 }, () => {
    const input = (size: number) => '# H\n\n' + 'a  \n'.repeat(size);
    expectLinear(input, 40000);
    const blocks = parseMarkdownToBlocks(input(40000));
    expect(blocks[0].type).toBe('Heading1');
    expect(blocks.slice(1).every((b) => b.type === 'Text')).toBe(true);
    expect(blocks.slice(1).reduce((n, b) => n + textOf(b).split('\n').filter((l) => l === 'a').length, 0)).toBe(40000);
  });

  it('reads a hash mid block as text, and not as a heading', () => {
    expect(read('Count\n# of items: 5\n\nend')).toEqual(['Text:Count\n# of items: 5', 'Text:end']);
  });

  it('reads `>` without a space as a quote', () => {
    expect(read('>quoted\n>more')).toEqual(['Quote:quoted\nmore']);
    expect(read('intro\n\n>quoted\n>more')).toEqual(['Text:intro', 'Quote:quoted\nmore']);
  });
});

describe('parseMarkdownToBlocks: leading numbers', () => {
  it('keeps a date or a year that opens a line as text', () => {
    expect(read('2. oktober')).toEqual(['Text:2. oktober']);
    expect(read('Meet on\n\n2. oktober\nat noon')).toEqual(['Text:Meet on', 'Text:2. oktober\nat noon']);
  });

  it('opens a list on an item numbered one, and lets the run count on', () => {
    expect(read('1. a\n2. b\n3. c')).toEqual(['NumberedList:a', 'NumberedList:b', 'NumberedList:c']);
    expect(read('1. a\n3. c')).toEqual(['NumberedList:a', 'Text:3. c']);
    expect(read('Agenda\n1. intro\n2. questions\n\nThanks')).toEqual([
      'Text:Agenda',
      'NumberedList:intro',
      'NumberedList:questions',
      'Text:Thanks',
    ]);
  });
});

describe('parseMarkdownToBlocks: a markdown document', () => {
  it('joins the paragraphs of a hard-wrapped readme', () => {
    expect(read('# Project\n\nThis is a hard\nwrapped paragraph.\n\n- an item\n  that wraps\n- next')).toEqual([
      'Heading1:Project',
      'Text:This is a hard wrapped paragraph.',
      'BulletList:an item that wraps',
      'BulletList:next',
    ]);
  });

  it('reads as a document on a fence or a table too', () => {
    expect(read('wrapped\nline\n\n```\ncode\n```')[0]).toBe('Text:wrapped line');
    expect(read('wrapped\nline\n\n| a | b |\n| --- | --- |')[0]).toBe('Text:wrapped line');
  });

  it('reads two trailing spaces and a backslash as hard breaks', () => {
    expect(read('# T\n\none  \ntwo\\\nthree\nfour')).toEqual(['Heading1:T', 'Text:one\ntwo\nthree four']);
  });

  it('lets any number open a list, as a markdown file numbers it', () => {
    expect(read('# Steps\n\n5. step five\n6. step six')).toEqual([
      'Heading1:Steps',
      'NumberedList:step five',
      'NumberedList:step six',
    ]);
    expect(read('# H\n\n1. a\n   - sub\n2. b').filter((r) => r.startsWith('NumberedList'))).toEqual([
      'NumberedList:a',
      'NumberedList:b',
    ]);
    // Under a bullet with no numbered list around it, a year is still the item's text.
    expect(read('# T\n\n- a\n1999. b')).toEqual(['Heading1:T', 'BulletList:a 1999. b']);
  });

  it('keeps the number that opens a run as its start, on the first item only', () => {
    const blocks = parseMarkdownToBlocks('# Steps\n\n8. eight\n9. nine');
    expect(blocks.map((b) => b.meta)).toEqual([{}, { listStart: 8 }, {}]);
    const nested = parseMarkdownToBlocks('# T\n\n- a\n\n  3. x\n  4. y')[1];
    expect(nested.children?.map((b) => b.meta)).toEqual([{ listStart: 3 }, {}]);
    expect(parseMarkdownToBlocks('# T\n\n1. a\n2. b').map((b) => b.meta)).toEqual([{}, {}, {}]);
    expect(parseMarkdownToBlocks('# T\n\n0. a\n1. b').map((b) => b.meta)).toEqual([{}, { listStart: 0 }, {}]);
  });

  it('reads an escaped number back as text', () => {
    expect(read('# Plan\n\n2\\. oktober')).toEqual(['Heading1:Plan', 'Text:2. oktober']);
    expect(read('2\\. oktober')).toEqual(['Text:2. oktober']);
  });

  it('stores no number outside a markdown document, where only a one opens a list', () => {
    expect(parseMarkdownToBlocks('1. a\n2. b').map((b) => b.meta)).toEqual([{}, {}]);
  });

  it('keeps both lists of install steps split by a code block', () => {
    const readme = '# Install\n\n1. Clone the repo\n2. Enter it\n\n```sh\ngit clone x\n```\n\n3. Build\n4. Run';
    expect(read(readme)).toEqual([
      'Heading1:Install',
      'NumberedList:Clone the repo',
      'NumberedList:Enter it',
      'Code:git clone x',
      'NumberedList:Build',
      'NumberedList:Run',
    ]);
  });

  it('leaves no visible closer of a centred div or a details block', () => {
    const readme =
      '# App\n\n<div align="center">\n\n**Fast** notes\n\n</div>\n\n<details>\n<summary>More</summary>\n\nHidden text\n\n</details>';
    const rows = read(readme);
    expect(rows.some((r) => r.includes('</'))).toBe(false);
    expect(rows).toContain('Text:Fast notes');
    expect(rows).toContain('Text:Hidden text');
  });

  it('reads a link with an angle-bracket destination as a link', () => {
    const [, block] = parseMarkdownToBlocks('# T\n\nSee [doc](<my file.md>) here');
    expect(textOf(block)).toBe('See doc here');
    expect(block.spans.some((s) => isTextSpan(s) && s.text === 'doc' && s.style.linkUrl === 'my file.md')).toBe(true);
  });

  it('keeps a wrapped line starting with a year inside its sentence', () => {
    expect(read('# T\n\nIt ended in\n1999. Then\n\n1. one\n2. two')).toEqual([
      'Heading1:T',
      'Text:It ended in 1999. Then',
      'NumberedList:one',
      'NumberedList:two',
    ]);
  });

  it('keeps the line breaks of a quote and nests a loose list', () => {
    expect(read('# T\n\n> a quote\n> that wraps\n\n- a\n\n  - b')).toEqual([
      'Heading1:T',
      'Quote:a quote\nthat wraps',
      'BulletList:a',
    ]);
    const [, , list] = parseMarkdownToBlocks('# T\n\n> q\n\n- a\n\n  - b');
    expect(list.children?.map(textOf)).toEqual(['b']);
  });

  it('reads a setext heading', () => {
    expect(read('# Doc\n\nTitle\n===')).toEqual(['Heading1:Doc', 'Heading1:Title']);
  });

  it('never makes an empty block of raw HTML, and keeps the text between its tags', () => {
    expect(read('# T\n\n<p align="center">\n\n<img src="x.png">\n\n<!-- note -->\n\n<p>Hello</p>')).toEqual([
      'Heading1:T',
      'Text:Hello',
    ]);
  });

  it('reads every kind of thematic break as a divider', () => {
    expect(read('# T\n\n***\n\n___\n\n- - -\n\n-----')).toEqual([
      'Heading1:T',
      'Divider:',
      'Divider:',
      'Divider:',
      'Divider:',
    ]);
  });

  it('keeps the alt text of badge links, and their links', () => {
    const [, badges] = parseMarkdownToBlocks(
      '# T\n\n[![CI](https://x.test/b.svg)](https://x.test/ci) [![npm](n.svg)](https://npm.test)',
    );
    expect(textOf(badges)).toBe('CI npm');
    expect(badges.spans.some((s) => isTextSpan(s) && s.text === 'CI' && s.style.linkUrl === 'https://x.test/ci')).toBe(
      true,
    );
  });

  it('reads a tilde fence with its info string, and leaves a bare fence without a language', () => {
    const [, tilde, bare] = parseMarkdownToBlocks('# T\n\n~~~python title="x"\nx = 1\n~~~\n\n```\nplain\n```');
    expect(tilde.payload).toMatchObject({ kind: 'code', language: 'python', source: 'x = 1' });
    expect(bare.payload).toMatchObject({ kind: 'code', language: '', source: 'plain' });
  });

  it('reads front matter at the very start as a yaml code block', () => {
    const [matter, heading] = parseMarkdownToBlocks('---\ntitle: Notes\ntags: [a]\n---\n\n# Body');
    expect(matter.payload).toMatchObject({ kind: 'code', language: 'yaml', source: 'title: Notes\ntags: [a]' });
    expect(heading.type).toBe('Heading1');
  });

  it('reads a heading right under front matter as a document', () => {
    const blocks = parseMarkdownToBlocks(
      '---\ntags: [a]\n---\n# Title\nSome **bold** and [a link](https://x.test)\n\n- [ ] task',
    );
    expect(blocks.map((b) => `${b.type}:${textOf(b)}`)).toEqual([
      'Code:tags: [a]',
      'Heading1:Title',
      'Text:Some bold and a link',
      'Checklist:task',
    ]);
    const spans = blocks[2].spans.filter(isTextSpan);
    expect(spans.some((sp) => sp.text === 'bold' && sp.style.bold)).toBe(true);
    expect(spans.some((sp) => sp.text === 'a link' && sp.style.linkUrl === 'https://x.test')).toBe(true);
  });
});

describe('parseMarkdownToBlocks: callouts', () => {
  it('reads an Obsidian callout, its title the first line, with the default glyph', () => {
    const [callout] = parseMarkdownToBlocks('> [!note] Title\n> body line');
    expect(callout.type).toBe('Callout');
    expect(callout.payload).toEqual({ kind: 'callout', emoji: '💡', tone: 'note' });
    expect(textOf(callout)).toBe('Title\nbody line');
  });

  it('reads a folded or warning-like type as the warning tone and glyph', () => {
    const [callout] = parseMarkdownToBlocks('> [!WARNING]- Careful\n> now');
    expect(callout.payload).toEqual({ kind: 'callout', emoji: '⚠️', tone: 'warn' });
    expect(textOf(callout)).toBe('Careful\nnow');
  });

  it("reads the editor's own head with its glyph, and ends a quote at a head", () => {
    expect(parseMarkdownToBlocks('> [!note 🧭] heads up')[0].payload).toEqual({
      kind: 'callout',
      emoji: '🧭',
      tone: 'note',
    });
    expect(read('> plain\n> [!tip] Tip')).toEqual(['Quote:plain', 'Callout:Tip']);
  });

  it('keeps the line breaks of a callout body in a document', () => {
    expect(read('# T\n\n> [!note] Title\n> body that\n> wraps\n\nafter')).toEqual([
      'Heading1:T',
      'Callout:Title\nbody that\nwraps',
      'Text:after',
    ]);
  });
});
