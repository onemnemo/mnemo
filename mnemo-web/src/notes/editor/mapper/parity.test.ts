/**
 * Regressions found by an adversarial review of the mapper.
 *
 * Every case here is a shape the wire format represents and an earlier version
 * of this code silently destroyed. They are all cycle-1 losses that are stable
 * afterwards — the class the three-cycle round-trip harness structurally cannot
 * see, because it baselines on cycle 1's output. That is why they live in their
 * own file with explicit before/after expectations rather than as fixtures.
 */

import { describe, expect, it } from 'vitest';
import { Node as PMNode } from 'prosemirror-model';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from './document';
import { parseBlock, parseSpans, serializeBlock } from '../../model/wire';
import { defaultTextStyle, type Block, type InlineSpan } from '../../model/types';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function cycle(blocks: readonly Block[]): Block[] {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  const restored = PMNode.fromJSON(
    schema,
    result.doc.toJSON() as Parameters<typeof PMNode.fromJSON>[1],
  );
  restored.check();
  return mapper.fromDoc(restored);
}

function blockOf(over: Partial<Block>): Block {
  return {
    id: 'id-1',
    sid: 'aaaaa',
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

const text = (t: string, style: Partial<typeof defaultTextStyle> = {}): InlineSpan => ({
  kind: 'text',
  text: t,
  style: { ...defaultTextStyle, ...style },
});

describe('mark coverage', () => {
  it('keeps subscript and superscript when a span has both', () => {
    // C# clears the pair in its command layer, not its serializer, so the wire
    // format represents both — and the frozen span fixture contains 228 such
    // styles. A `MarkSpec.excludes` here evicted `sub` on load.
    const out = cycle([blockOf({ spans: [text('x', { subscript: true, superscript: true })] })]);
    const style = out[0].spans[0].style;
    expect(style.subscript).toBe(true);
    expect(style.superscript).toBe(true);
  });

  it('keeps a span that is both code and bold', () => {
    const out = cycle([blockOf({ spans: [text('x', { code: true, bold: true })] })]);
    expect(out[0].spans[0].style.code).toBe(true);
    expect(out[0].spans[0].style.bold).toBe(true);
  });
});

describe('source blocks', () => {
  it('keeps an inline equation inside a code block', () => {
    // A code line forbids marks, which is deliberate. Dropping whole spans is
    // not: `WriteSpans` preserves atoms regardless of block type.
    const blocks = [
      blockOf({
        type: 'Code',
        spans: [
          text('a'),
          { kind: 'equation', latex: 'x^2', style: { ...defaultTextStyle } },
          text('b'),
        ],
        payload: { kind: 'code', language: 'ts', source: '' },
      }),
    ];
    const out = cycle(blocks);
    expect(out[0].spans.some((s) => s.kind === 'equation')).toBe(true);
  });

  it('strips marks on a code line, which is the documented restriction', () => {
    const out = cycle([
      blockOf({
        type: 'Code',
        spans: [text('bolded', { bold: true })],
        payload: { kind: 'code', language: 'ts', source: '' },
      }),
    ]);
    expect(out[0].spans[0].style.bold).toBe(false);
  });
});

describe('numeric payload fields', () => {
  it('preserves a two-column split ratio of 0', () => {
    // `Number(x) || 0.5` rewrote it, because 0 is falsy. C# passes a stored 0
    // through untouched; it only normalizes on the legacy meta path.
    const cell = blockOf({ type: 'ColumnGroup', id: 'c', sid: 'bbbbb' });
    const out = cycle([
      blockOf({
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0 },
        children: [cell, { ...cell, id: 'c2', sid: 'ccccc' }],
      }),
    ]);
    expect(out[0].payload).toMatchObject({ kind: 'twoColumn', splitRatio: 0 });
  });
});

describe('wire reader and writer parity with BlockJsonConverter', () => {
  it('backfills a two-column payload from meta before stripping the shadow key', () => {
    // The C# writer backfills then strips. Stripping alone destroys the ratio.
    const block = parseBlock({
      id: 'x',
      type: 'TwoColumn',
      payload: { kind: 'empty' },
      meta: { columnSplitRatio: 0.3 },
      spans: [],
      order: 0,
    });
    const written = serializeBlock({ ...block, payload: { kind: 'empty' } });
    expect(written.payload).toMatchObject({ kind: 'twoColumn', splitRatio: 0.3 });
    expect(written.meta).not.toHaveProperty('columnSplitRatio');
  });

  it('backfills a page payload from meta before stripping the shadow key', () => {
    const written = serializeBlock(
      blockOf({
        type: 'Page',
        payload: { kind: 'empty' },
        meta: { reference_note_id: 'note-42' },
      }),
    );
    expect(written.payload).toMatchObject({ kind: 'page', referenceNoteId: 'note-42' });
    expect(written.meta).not.toHaveProperty('reference_note_id');
  });

  it('clamps a legacy split ratio to the range NormalizeSplitRatio uses', () => {
    const block = parseBlock({
      id: 'x',
      type: 'TwoColumn',
      meta: { columnSplitRatio: 0.05 },
      spans: [],
      order: 0,
    });
    expect(block.payload).toMatchObject({ kind: 'twoColumn', splitRatio: 0.1 });
  });

  it('treats a present but empty spans array as authoritative', () => {
    // C#'s reader returns one blank span and never consults `content`. Falling
    // back would resurrect text the user had deliberately cleared.
    const block = parseBlock({ id: 'x', type: 'Text', spans: [], content: 'hello', order: 0 });
    expect(block.spans.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual(['']);
  });

  it('promotes a legacy themed background to a highlight when reading a note', () => {
    const block = parseBlock({
      id: 'x',
      type: 'Text',
      order: 0,
      spans: [{ kind: 'text', text: 'hi', style: { backgroundColor: '#FFD7AA' } }],
    });
    expect(block.spans[0].style.highlight).toBe(true);
    expect(block.spans[0].style.backgroundColor).toBeNull();
  });

  it('does not promote inside the raw span parser the differential reuses', () => {
    // The frozen cross-language fixture uses `#FFD7AA` as an ordinary palette
    // color. Promoting here rewrote its inputs and broke three of its cases.
    const spans = parseSpans([
      { kind: 'text', text: 'hi', style: { backgroundColor: '#FFD7AA' } },
    ]);
    expect(spans[0].style.highlight).toBe(false);
    expect(spans[0].style.backgroundColor).toBe('#FFD7AA');
  });
});

describe('payload and type agreement', () => {
  it('reports a payload whose kind does not match its block type', () => {
    // The wire format lets these disagree — C# never cross-validates them — but
    // the schema decomposes a payload into type-specific attrs, so a wrong-kind
    // payload has nowhere to live and would vanish on the first save.
    const result = mapper.toDoc([
      blockOf({ type: 'Text', payload: { kind: 'checklist', checked: true } }),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.issues[0].code).toBe('payload-type-mismatch');
  });

  it('accepts an empty payload on any block type, which legacy data relies on', () => {
    for (const type of ['Checklist', 'Code', 'Image', 'Sketch', 'Equation'] as const) {
      const result = mapper.toDoc([blockOf({ type, payload: { kind: 'empty' } })]);
      expect(result.ok, `${type} with an empty payload was rejected`).toBe(true);
    }
  });
});

describe('robustness', () => {
  it('does not quarantine a whole note because a leaf block carries children', () => {
    // Nothing creates this shape, but one stray child made an entire readable
    // note fail to open.
    for (const type of ['Divider', 'Image', 'Equation', 'Page'] as const) {
      const result = mapper.toDoc([
        blockOf({ type, children: [blockOf({ id: 'kid', sid: 'ddddd' })] }),
      ]);
      expect(result.ok, `${type} was quarantined`).toBe(true);
    }
  });

  it('does not hand out the live document node as a block meta bag', () => {
    // PM nodes are shared and persistent, so aliasing lets a consumer mutating
    // a returned block mutate the document — and the default meta object is
    // shared by every node that omits one.
    const meta = { keep: 1 };
    const out = cycle([blockOf({ meta })]);
    expect(out[0].meta).toEqual(meta);
    expect(out[0].meta).not.toBe(meta);
  });
});
