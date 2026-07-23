import { describe, expect, it } from 'vitest';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from '../mapper/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../../model/types';
import { countWords, documentWordCount } from './word-count';

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

describe('countWords', () => {
  it('counts maximal non-whitespace runs', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('does not mint an empty word from leading, trailing or repeated whitespace', () => {
    expect(countWords('   one   two  ')).toBe(2);
    expect(countWords('one\n\ntwo\t\tthree')).toBe(3);
  });

  it('is zero for an empty or whitespace-only string', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });
});

describe('documentWordCount', () => {
  it('counts words across blocks, joined at block boundaries', () => {
    const doc = docOf([
      blockOf({ type: 'Heading1', spans: [text('The Title')] }),
      blockOf({ spans: [text('two words')] }),
    ]);
    expect(documentWordCount(doc, registry)).toBe(4);
  });

  it('counts a code block by its source, not as one opaque token', () => {
    const doc = docOf([
      blockOf({
        type: 'Code',
        spans: [text('let x = 1')],
        payload: { kind: 'code', language: 'ts', source: 'let x = 1' },
      }),
    ]);
    expect(documentWordCount(doc, registry)).toBe(4);
  });

  it('counts words nested inside a layout island', () => {
    const doc = docOf([
      blockOf({
        type: 'TwoColumn',
        payload: { kind: 'twoColumn', splitRatio: 0.5 },
        children: [
          blockOf({ type: 'ColumnGroup', children: [blockOf({ spans: [text('alpha beta')] })] }),
          blockOf({ type: 'ColumnGroup', children: [blockOf({ spans: [text('gamma')] })] }),
        ],
      }),
    ]);
    expect(documentWordCount(doc, registry)).toBe(3);
  });

  it('is zero for a document with no words', () => {
    expect(documentWordCount(docOf([]), registry)).toBe(0);
    expect(documentWordCount(docOf([blockOf({ spans: [text('   ')] })]), registry)).toBe(0);
  });

  it('equals the token count of the canonical text projection', () => {
    // The metadata line and the search index cannot disagree about how long a
    // note is, because they count the same string.
    const doc = docOf([
      blockOf({ type: 'Heading2', spans: [text('A heading here')] }),
      blockOf({ type: 'Quote', spans: [text('a quoted line')] }),
      blockOf({ spans: [text('body text with five words')] }),
    ]);
    expect(documentWordCount(doc, registry)).toBe(3 + 3 + 5);
  });
});
