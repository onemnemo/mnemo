import { describe, expect, it } from 'vitest';

import { parseInlineMarkdown } from './markdown';
import { defaultTextStyle, type InlineSpan, type TextStyle } from './types';

/** A span list flattened to `text|flags` rows, so a test reads as one line per span. */
function rows(spans: readonly InlineSpan[]): string[] {
  return spans.map((span) => {
    if (span.kind === 'equation') return `eq:${span.latex}`;
    if (span.kind === 'fraction') return `fr:${span.numerator}/${span.denominator}${flags(span.style)}`;
    return `${span.text}${flags(span.style)}`;
  });
}

function flags(style: TextStyle): string {
  const on: string[] = [];
  if (style.bold) on.push('b');
  if (style.italic) on.push('i');
  if (style.strikethrough) on.push('s');
  if (style.code) on.push('code');
  // Compared against null, not truthiness: a link set to the empty string is a
  // different (and wrong) state from no link at all, and truthiness hides it.
  if (style.linkUrl !== null) on.push(`link=${style.linkUrl}`);
  return on.length > 0 ? `|${on.join(',')}` : '';
}

describe('empty input', () => {
  // A block with no spans has nowhere to put the caret, so every one of these
  // has to produce a span rather than an empty list.
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['newlines', '\n\n'],
    ['a thematic break, which contributes no text', '---'],
  ])('yields one empty span for %s', (_label, input) => {
    expect(parseInlineMarkdown(input)).toEqual([{ kind: 'text', text: '', style: defaultTextStyle }]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('yields one empty span for %s', (_label, input) => {
    expect(parseInlineMarkdown(input)).toEqual([{ kind: 'text', text: '', style: defaultTextStyle }]);
  });
});

describe('emphasis', () => {
  it('parses bold', () => {
    expect(rows(parseInlineMarkdown('**loud**'))).toEqual(['loud|b']);
  });

  it.each([
    ['asterisks', '*soft*'],
    ['underscores', '_soft_'],
  ])('parses italic with %s', (_label, input) => {
    expect(rows(parseInlineMarkdown(input))).toEqual(['soft|i']);
  });

  it('parses triple delimiters as both bold and italic', () => {
    expect(rows(parseInlineMarkdown('***both***'))).toEqual(['both|b,i']);
  });

  it('accumulates nested emphasis rather than replacing it', () => {
    expect(rows(parseInlineMarkdown('**a *b* c**'))).toEqual(['a |b', 'b|b,i', ' c|b']);
  });

  it('parses strikethrough', () => {
    expect(rows(parseInlineMarkdown('~~gone~~'))).toEqual(['gone|s']);
  });

  it('treats a single tilde as strikethrough, unlike the C# parser', () => {
    // GFM allows one tilde; Markdig requires two and leaves this as plain text.
    // Pinned so the divergence is a decision on record, not a surprise later.
    expect(rows(parseInlineMarkdown('~one~'))).toEqual(['one|s']);
  });

  it('leaves an unmatched delimiter as literal text', () => {
    expect(rows(parseInlineMarkdown('2 * 3 * 4'))).toEqual(['2 * 3 * 4']);
  });
});

describe('code', () => {
  it('parses inline code', () => {
    expect(rows(parseInlineMarkdown('run `npm test` now'))).toEqual(['run ', 'npm test|code', ' now']);
  });

  it('does not parse markdown inside code', () => {
    expect(rows(parseInlineMarkdown('`**not bold**`'))).toEqual(['**not bold**|code']);
  });

  it('unwraps a fenced code block to its contents, without the fence', () => {
    expect(rows(parseInlineMarkdown('```ts\nlet x = 1\n```'))).toEqual(['let x = 1']);
  });
});

describe('links', () => {
  it('parses an inline link', () => {
    expect(rows(parseInlineMarkdown('[docs](https://mnemo.app)'))).toEqual([
      'docs|link=https://mnemo.app',
    ]);
  });

  it('parses a bare url as a link', () => {
    expect(rows(parseInlineMarkdown('https://mnemo.app'))).toEqual([
      'https://mnemo.app|link=https://mnemo.app',
    ]);
  });

  it('parses an angle-bracket autolink', () => {
    expect(rows(parseInlineMarkdown('<https://mnemo.app>'))).toEqual([
      'https://mnemo.app|link=https://mnemo.app',
    ]);
  });

  it('normalizes a www host into a url', () => {
    expect(rows(parseInlineMarkdown('[docs](www.mnemo.app)'))).toEqual([
      'docs|link=https://www.mnemo.app',
    ]);
  });

  it('leaves a destination that is not a bare www host alone', () => {
    // Matches the C# NormalizeUrl, which only ever adds a scheme to `www.`.
    // Relative and custom-scheme destinations have to survive untouched.
    expect(rows(parseInlineMarkdown('[docs](mnemo.app)'))).toEqual(['docs|link=mnemo.app']);
  });

  it('keeps emphasis inside a link', () => {
    expect(rows(parseInlineMarkdown('[**bold**](https://mnemo.app)'))).toEqual([
      'bold|b,link=https://mnemo.app',
    ]);
  });

  it('drops a link with an empty destination', () => {
    // A styled span that renders as a link and navigates nowhere is worse than
    // plain text. Asserted on the span itself, since an empty-string linkUrl
    // and a null one both render as "no visible href" in a flattened row.
    const spans = parseInlineMarkdown('[text]()');
    expect(spans).toEqual([{ kind: 'text', text: 'text', style: defaultTextStyle }]);
    expect((spans[0] as { style: TextStyle }).style.linkUrl).toBeNull();
  });
});

describe('math', () => {
  it('parses inline math into an equation atom', () => {
    expect(rows(parseInlineMarkdown('so $x^2$ then'))).toEqual(['so ', 'eq:x^2', ' then']);
  });

  it('trims the latex', () => {
    expect(rows(parseInlineMarkdown('$  x^2  $'))).toEqual(['eq:x^2']);
  });

  it('drops empty math rather than emitting a blank atom', () => {
    expect(rows(parseInlineMarkdown('a $ $ b'))).toEqual(['a  b']);
  });

  it('gives an equation no style even inside bold', () => {
    // Matches the C# span model, where EquationSpan carries no style at all.
    const spans = parseInlineMarkdown('**$x^2$**');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({ kind: 'equation', latex: 'x^2', style: defaultTextStyle });
  });
});

describe('fraction tokens', () => {
  it('parses a fraction token into an atom', () => {
    expect(rows(parseInlineMarkdown(String.raw`add \1/2 cup`))).toEqual(['add ', 'fr:1/2', ' cup']);
  });

  it('parses multi-digit fractions', () => {
    expect(rows(parseInlineMarkdown(String.raw`\12/34`))).toEqual(['fr:12/34']);
  });

  it('parses several in one run', () => {
    expect(rows(parseInlineMarkdown(String.raw`\1/2 and \3/4`))).toEqual([
      'fr:1/2',
      ' and ',
      'fr:3/4',
    ]);
  });

  it('leaves a zero denominator as literal text', () => {
    expect(rows(parseInlineMarkdown(String.raw`\1/0`))).toEqual([String.raw`\1/0`]);
  });

  it('carries the surrounding style onto the atom', () => {
    expect(rows(parseInlineMarkdown(String.raw`**\1/2**`))).toEqual(['fr:1/2|b']);
  });

  it('ignores a slash that is not a fraction token', () => {
    expect(rows(parseInlineMarkdown('and/or'))).toEqual(['and/or']);
  });
});

describe('block flattening', () => {
  it('joins paragraphs with a newline', () => {
    expect(rows(parseInlineMarkdown('one\n\ntwo'))).toEqual(['one\ntwo']);
  });

  it('keeps a hard break inside one block', () => {
    expect(rows(parseInlineMarkdown('one  \ntwo'))).toEqual(['one\ntwo']);
  });

  it('flattens a heading to its text, losing the level', () => {
    // The block type comes from the op, never from the markdown, so `#` here is
    // formatting the model cannot express and should not be able to smuggle in.
    expect(rows(parseInlineMarkdown('# Title'))).toEqual(['Title']);
  });

  it('flattens list items to newline-joined lines', () => {
    expect(rows(parseInlineMarkdown('- a\n- b'))).toEqual(['a\nb']);
  });

  it('flattens a nested list', () => {
    expect(rows(parseInlineMarkdown('- a\n  - b'))).toEqual(['a\nb']);
  });

  it('flattens a blockquote', () => {
    expect(rows(parseInlineMarkdown('> quoted'))).toEqual(['quoted']);
  });

  it('keeps emphasis through the flattening', () => {
    expect(rows(parseInlineMarkdown('- **a**\n- b'))).toEqual(['a|b', '\nb']);
  });
});

describe('html', () => {
  it('drops inline html rather than showing the tag', () => {
    expect(rows(parseInlineMarkdown('a <span> b'))).toEqual(['a  b']);
  });
});

describe('normalization', () => {
  it('merges adjacent runs that ended up with the same style', () => {
    // A rejected fraction token is pushed as its own span between two text
    // spans; all three share a style, so normalization must collapse them.
    expect(rows(parseInlineMarkdown(String.raw`x\1/0y`))).toEqual([String.raw`x\1/0y`]);
  });

  it('produces no zero-length spans', () => {
    for (const span of parseInlineMarkdown('**a** `b` [c](d) $e$')) {
      if (span.kind === 'text') expect(span.text.length).toBeGreaterThan(0);
    }
  });
});
