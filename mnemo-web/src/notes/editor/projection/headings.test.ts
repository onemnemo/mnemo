import { describe, expect, it } from 'vitest';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from '../mapper/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../../model/types';
import { documentHeadings } from './headings';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

let nextSid = 0;
function blockOf(over: Partial<Block> = {}): Block {
  nextSid += 1;
  return {
    id: `id-${String(nextSid)}`,
    sid: `s${String(nextSid).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}

const text = (t: string): InlineSpan => ({ kind: 'text', text: t, style: { ...defaultTextStyle } });

function docOf(blocks: readonly Block[]) {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

describe('documentHeadings', () => {
  it('lists the four heading levels in document order with their text', () => {
    const doc = docOf([
      blockOf({ type: 'Heading1', sid: 'h1', spans: [text('First')] }),
      blockOf({ spans: [text('body')] }),
      blockOf({ type: 'Heading3', sid: 'h3', spans: [text('Deeper')] }),
      blockOf({ type: 'Heading2', sid: 'h2', spans: [text('Second')] }),
    ]);
    expect(documentHeadings(doc, registry)).toMatchObject([
      { sid: 'h1', level: 1, text: 'First' },
      { sid: 'h3', level: 3, text: 'Deeper' },
      { sid: 'h2', level: 2, text: 'Second' },
    ]);
  });

  it('skips a blank heading a reader has not filled in', () => {
    const doc = docOf([
      blockOf({ type: 'Heading1', spans: [text('   ')] }),
      blockOf({ type: 'Heading2', sid: 'real', spans: [text('Real')] }),
    ]);
    expect(documentHeadings(doc, registry).map((h) => h.sid)).toEqual(['real']);
  });

  it('collapses internal whitespace to a single-line title', () => {
    const doc = docOf([blockOf({ type: 'Heading1', spans: [text('  spaced   out  ')] })]);
    expect(documentHeadings(doc, registry)[0].text).toBe('spaced out');
  });

  it('ignores headings nested inside a layout island', () => {
    const doc = docOf([
      blockOf({ type: 'Heading1', sid: 'top', spans: [text('Top')] }),
      blockOf({
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({ type: 'ColumnGroup', children: [blockOf({ type: 'Heading2', spans: [text('Nested') ] })] }),
          blockOf({ type: 'ColumnGroup' }),
        ],
      }),
    ]);
    expect(documentHeadings(doc, registry).map((h) => h.sid)).toEqual(['top']);
  });

  it('reports a position the document resolves to that heading', () => {
    const doc = docOf([
      blockOf({ spans: [text('intro')] }),
      blockOf({ type: 'Heading2', sid: 'h', spans: [text('Chapter')] }),
    ]);
    const [heading] = documentHeadings(doc, registry);
    expect(doc.nodeAt(heading.pos)?.attrs.sid).toBe('h');
  });

  it('is empty for a document with no headings', () => {
    expect(documentHeadings(docOf([blockOf({ spans: [text('just body')] })]), registry)).toEqual([]);
  });
});
