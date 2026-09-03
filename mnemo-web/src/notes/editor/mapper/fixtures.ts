/**
 * Structural fixtures for the round-trip proof.
 *
 * Shaped after the real corpus rather than after the type list: the counts and
 * quirks that appear here, a code block storing its source twice, an image
 * whose caption equals its alt text, two-column blocks with user-resized
 * ratios, meta keys nothing in the editor reads, are the things real notes
 * actually contain. A fixture set built from the schema instead would prove
 * only that the schema agrees with itself.
 */

import type { Block, BlockPayload, BlockType, InlineSpan, TextStyle } from '../../model/types';
import { defaultTextStyle } from '../../model/types';

let sidCounter = 0;

/** Deterministic, so a failing fixture is reproducible from its name alone. */
function nextSid(): string {
  sidCounter += 1;
  return `s${String(sidCounter).padStart(4, '0')}`;
}

export function resetFixtureIds(): void {
  sidCounter = 0;
}

export function styled(overrides: Partial<TextStyle>): TextStyle {
  return { ...defaultTextStyle, ...overrides };
}

export function span(text: string, style: Partial<TextStyle> = {}): InlineSpan {
  return { kind: 'text', text, style: styled(style) };
}

export function block(
  type: BlockType,
  spans: InlineSpan[],
  payload: BlockPayload = { kind: 'empty' },
  extra: Partial<Block> = {},
): Block {
  return {
    id: `id-${String(sidCounter + 1)}`,
    sid: nextSid(),
    type,
    spans,
    payload,
    meta: {},
    order: 0,
    children: null,
    ...extra,
  };
}

export interface Fixture {
  readonly name: string;
  readonly blocks: readonly Block[];
}

export function structuralFixtures(): readonly Fixture[] {
  resetFixtureIds();
  return [
    {
      name: 'prose with every mark',
      blocks: [
        block('Text', [
          span('plain '),
          span('bold', { bold: true }),
          span('italic', { italic: true }),
          span('under', { underline: true }),
          span('struck', { strikethrough: true }),
          span('code', { code: true }),
          span('marked', { highlight: true }),
          span('swatched', { backgroundColor: 'swatch5' }),
          span('fg', { foregroundColor: 'swatch2' }),
          span('linked', { linkUrl: 'https://example.com/a?b=c&d=e' }),
          span('nolink', { suppressAutoLink: true }),
          span('sub', { subscript: true }),
          span('sup', { superscript: true }),
        ]),
      ],
    },
    {
      name: 'a mark combination applied in an awkward order',
      blocks: [
        block('Text', [
          span('all at once', {
            bold: true,
            italic: true,
            code: true,
            linkUrl: 'https://example.com',
            highlight: true,
          }),
        ]),
      ],
    },
    {
      name: 'all four heading levels',
      blocks: (['Heading1', 'Heading2', 'Heading3', 'Heading4'] as BlockType[]).map((type) =>
        block(type, [span(`${type} text`, { bold: true })]),
      ),
    },
    {
      name: 'the three list kinds',
      blocks: [
        block('BulletList', [span('first bullet')]),
        block('BulletList', [span('second bullet')]),
        block('NumberedList', [span('one')], { kind: 'empty' }, {
          meta: { listNumberIndex: 1, listNumber: '1.' },
        }),
        block('NumberedList', [span('two')], { kind: 'empty' }, {
          meta: { listNumberIndex: 2, listNumber: '2.' },
        }),
        block('Checklist', [span('done')], { kind: 'checklist', checked: true }),
        block('Checklist', [span('not done')], { kind: 'checklist', checked: false }),
      ],
    },
    {
      name: 'nested lists, three deep and mixed',
      blocks: [
        block('BulletList', [span('parent')], { kind: 'empty' }, {
          children: [
            block('NumberedList', [span('child')], { kind: 'empty' }, {
              children: [block('Checklist', [span('grandchild')], { kind: 'checklist', checked: true })],
            }),
            block('BulletList', [span('second child')]),
          ],
        }),
        block('BulletList', [span('sibling')]),
      ],
    },
    {
      name: 'quote and divider',
      blocks: [
        block('Quote', [span('a quoted line')]),
        block('Divider', [span('')]),
      ],
    },
    {
      name: 'callouts, including a glyph-less one and a tone the menu never offers',
      blocks: [
        block('Callout', [span('remember this'), span('bit', { bold: true })], {
          kind: 'callout',
          emoji: '💡',
          tone: 'note',
        }),
        block('Callout', [span('careful')], { kind: 'callout', emoji: '⚠️', tone: 'warn' }),
        block('Callout', [span('no glyph')], { kind: 'callout', emoji: '', tone: 'note' }),
        block('Callout', [span('hand written')], {
          kind: 'callout',
          emoji: '📌',
          tone: 'custom-tone',
        }),
        // Any glyph the picker offers is storable, not only the two the slash menu
        // inserts, and a multi-codepoint one is the case a naive char-at-a-time
        // read of the markdown head would split.
        block('Callout', [span('picked after the fact')], {
          kind: 'callout',
          emoji: '🧑‍🚀',
          tone: 'note',
        }),
        // Written before the payload existed, so it carries the wire format's
        // "no payload" sentinel and must still open.
        block('Callout', [span('a legacy callout')]),
      ],
    },
    {
      name: 'code storing its source in both places',
      blocks: [
        block('Code', [span('const x = 1;\nconst y = 2;')], {
          kind: 'code',
          language: 'typescript',
          source: 'const x = 1;\nconst y = 2;',
        }),
      ],
    },
    {
      name: 'sketch with the CRLF endings real data has',
      blocks: [
        block('Sketch', [span('line one\r\nline two\r\n')], {
          kind: 'sketch',
          width: 320,
          align: 'center',
        }),
      ],
    },
    {
      name: 'image whose caption equals its alt text',
      blocks: [
        block('Image', [span('A diagram of the pipeline')], {
          kind: 'image',
          path: 'attachment:abc123',
          alt: 'A diagram of the pipeline',
          width: 480,
          align: 'center',
          crop: null,
        }),
        block('Image', [span('')], {
          kind: 'image',
          path: 'C:/Users/someone/Pictures/absolute.png',
          alt: '',
          width: 0,
          align: 'left',
          crop: null,
        }),
        // The shape the web app's own uploads store: a managed asset id.
        block('Image', [span('uploaded')], {
          kind: 'image',
          path: '9f2c1de4a0b34b9c8f6d7e5a4c3b2a10.png',
          alt: 'uploaded',
          width: 320,
          align: 'right',
          crop: null,
        }),
      ],
    },
    {
      // Every image saved before crops existed is the second block here, and it
      // has to keep serializing without the field at all, which is what makes the
      // bytes of an untouched note identical to the ones it was stored as.
      name: 'image with a crop, beside one from before crops existed',
      blocks: [
        block('Image', [span('the interesting corner')], {
          kind: 'image',
          path: 'attachment:cropped01',
          alt: 'the interesting corner',
          width: 420,
          align: 'center',
          crop: { x: 0.12, y: 0.34, w: 0.5, h: 0.25, aspect: 1.7777777777777777 },
        }),
        block('Image', [span('untouched')], {
          kind: 'image',
          path: 'attachment:legacy01',
          alt: 'untouched',
          width: 260,
          align: 'left',
          crop: null,
        }),
        // A window pinned to the source's far corner, which is where an off-by-one
        // in the offset math shows up rather than in a centred one.
        block('Image', [span('')], {
          kind: 'image',
          path: 'e1c0ffee00004b9c8f6d7e5a4c3b2a10.png',
          alt: '',
          width: 0,
          align: 'right',
          crop: { x: 0.75, y: 0.8, w: 0.25, h: 0.2, aspect: 1 },
        }),
      ],
    },
    {
      // Regression: a styled caption with an empty `alt` used to survive the
      // first save and be flattened to plain text by the second, because `alt`
      // is derived from the caption and was also being trusted as its source.
      // Found by a seeded property fixture; pinned here so the coverage does not
      // depend on that seed staying the same.
      name: 'image with a styled caption and no alt yet',
      blocks: [
        block(
          'Image',
          [
            span('a '),
            span('bold', { bold: true }),
            span(' caption with a '),
            span('link', { linkUrl: 'https://example.com' }),
            { kind: 'equation', latex: '\\pi r^2', style: styled({}) },
          ],
          { kind: 'image', path: 'attachment:def456', alt: '', width: 200, align: 'left', crop: null },
        ),
      ],
    },
    {
      name: 'inline atoms, styled',
      blocks: [
        block('Text', [
          span('before '),
          { kind: 'equation', latex: '\\frac{a}{b}', style: styled({ bold: true }) },
          span(' between '),
          { kind: 'fraction', numerator: 3, denominator: 4, style: styled({ italic: true }) },
          span(' after'),
        ]),
      ],
    },
    {
      name: 'block equation and page reference, whose spans are force-cleared',
      blocks: [
        block('Equation', [span('')], { kind: 'equation', latex: 'E = mc^2' }),
        block('Page', [span('')], {
          kind: 'page',
          referenceNoteId: '7f3b2a10-0000-4000-8000-000000000001',
        }),
      ],
    },
    {
      name: 'two-column with a user-resized ratio',
      blocks: [
        block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5725 }, {
          children: [
            block('ColumnGroup', [span('')], { kind: 'empty' }, {
              children: [block('Text', [span('left cell')])],
            }),
            block('ColumnGroup', [span('')], { kind: 'empty' }, {
              children: [block('Text', [span('right cell')])],
            }),
          ],
        }),
      ],
    },
    {
      name: 'nested two-column, deeper than the product creates',
      blocks: [
        block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.517 }, {
          children: [
            block('ColumnGroup', [span('')], { kind: 'empty' }, {
              children: [
                block('TwoColumn', [span('')], { kind: 'twoColumn', splitRatio: 0.5 }, {
                  children: [
                    block('ColumnGroup', [span('')], { kind: 'empty' }, {
                      children: [block('Text', [span('deep left')])],
                    }),
                    block('ColumnGroup', [span('')], { kind: 'empty' }, {
                      children: [block('Text', [span('deep right')])],
                    }),
                  ],
                }),
              ],
            }),
            block('ColumnGroup', [span('')], { kind: 'empty' }, {
              children: [block('Text', [span('shallow right')])],
            }),
          ],
        }),
      ],
    },
    {
      name: 'meta keys nothing in the editor reads',
      blocks: [
        block('Text', [span('carries baggage')], { kind: 'empty' }, {
          meta: {
            nativeTwoColumn: true,
            somethingFromTheFuture: { nested: ['a', 1, null] },
            aNumber: 42,
          },
        }),
      ],
    },
    {
      name: 'an empty block, the canonical empty shape',
      blocks: [block('Text', [span('')])],
    },
    {
      name: 'unicode that has broken serializers before',
      blocks: [
        block('Text', [span('emoji 👩‍👩‍👧‍👦 zwj, 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 astral, ́combining')]),
        block('Text', [span('RTL: مرحبا بالعالم, CJK: 日本語のテキスト')]),
        block('Text', [span('quotes "double" \'single\' and a backslash \\ and a tab\t')]),
      ],
    },
    {
      name: 'order values, which a save rewrites to document position',
      blocks: [
        block('Text', [span('first')], { kind: 'empty' }, { order: 40 }),
        block('Text', [span('second')], { kind: 'empty' }, { order: 10 }),
        block('Text', [span('third')], { kind: 'empty' }, { order: 30 }),
      ],
    },
  ];
}

/** A document large enough that a per-block cost shows up as a real number. */
export function scaleFixture(blockCount: number): Fixture {
  resetFixtureIds();
  const blocks: Block[] = [];
  for (let i = 0; i < blockCount; i += 1) {
    const kind = i % 7;
    if (kind === 0) blocks.push(block('Heading2', [span(`Section ${String(i)}`, { bold: true })]));
    else if (kind === 1) blocks.push(block('BulletList', [span(`item ${String(i)}`)]));
    else if (kind === 2) {
      blocks.push(
        block('Text', [
          span('mixed '),
          span('bold', { bold: true }),
          span(` tail ${String(i)}`, { linkUrl: 'https://example.com' }),
        ]),
      );
    } else if (kind === 3) {
      blocks.push(
        block('Code', [span(`let v${String(i)} = ${String(i)};`)], {
          kind: 'code',
          language: 'typescript',
          source: `let v${String(i)} = ${String(i)};`,
        }),
      );
    } else if (kind === 4) {
      blocks.push(block('Checklist', [span(`task ${String(i)}`)], {
        kind: 'checklist',
        checked: i % 2 === 0,
      }));
    } else if (kind === 5) {
      blocks.push(
        block('Text', [
          span('with atom '),
          { kind: 'equation', latex: `x_{${String(i)}}`, style: styled({}) },
        ]),
      );
    } else blocks.push(block('Text', [span(`paragraph ${String(i)} `.repeat(4))]));
  }
  return { name: `scale-${String(blockCount)}`, blocks };
}
