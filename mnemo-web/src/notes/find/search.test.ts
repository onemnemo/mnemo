import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { createEditorSchema } from '../editor/schema';
import { createDocumentMapper } from '../editor/mapper/document';
import { projectDocument } from '../editor/projection/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import {
  dropStale,
  projectionOf,
  searchDocument,
  withIdentity,
  type FindMatch,
  type FindOptions,
} from './search';

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
const equation = (latex: string): InlineSpan => ({ kind: 'equation', latex, style: { ...defaultTextStyle } });

function docOf(blocks: readonly Block[]) {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

const INSENSITIVE: FindOptions = { caseSensitive: false, wholeWord: false };

/** Project and search one document, the way the live search does. */
function sd(doc: PMNode, query: string, options: FindOptions): FindMatch[] {
  return searchDocument(projectDocument(doc, registry), query, options, doc);
}

describe('searchDocument', () => {
  it('finds prose matches, each carrying its block sid and exact text', () => {
    const doc = docOf([
      blockOf({ sid: 'aaaaa', spans: [text('the quick brown fox')] }),
      blockOf({ sid: 'bbbbb', type: 'Quote', spans: [text('the lazy dog')] }),
    ]);
    const matches = sd(doc, 'the', INSENSITIVE);

    expect(matches.map((m) => m.sid)).toEqual(['aaaaa', 'bbbbb']);
    for (const match of matches) {
      expect(match.backing).toBe('text');
      expect(match.exactText).toBe('the');
      // The whole point of the position mapping: the resolved range holds the
      // matched text in the real document.
      expect(doc.textBetween(match.from, match.to)).toBe('the');
    }
  });

  it('returns nothing for an empty query', () => {
    const doc = docOf([blockOf({ spans: [text('anything')] })]);
    expect(sd(doc, '', INSENSITIVE)).toEqual([]);
  });

  it('is case-insensitive by default and exact when case-sensitive', () => {
    const doc = docOf([blockOf({ spans: [text('Foo foo FOO')] })]);

    expect(sd(doc, 'foo', INSENSITIVE)).toHaveLength(3);
    const sensitive = sd(doc, 'foo', { caseSensitive: true, wholeWord: false });
    expect(sensitive).toHaveLength(1);
    expect(sensitive[0].exactText).toBe('foo');
  });

  it('preserves the document casing in exactText for a case-insensitive hit', () => {
    const doc = docOf([blockOf({ spans: [text('Introduction')] })]);
    const matches = sd(doc, 'intro', INSENSITIVE);
    expect(matches).toHaveLength(1);
    expect(matches[0].exactText).toBe('Intro');
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe('Intro');
  });

  it('honors whole-word boundaries', () => {
    const doc = docOf([blockOf({ spans: [text('cat category scatter cat')] })]);

    expect(sd(doc, 'cat', INSENSITIVE)).toHaveLength(4);
    expect(sd(doc, 'cat', { caseSensitive: false, wholeWord: true })).toHaveLength(2);
  });

  it('does not overlap matches', () => {
    const doc = docOf([blockOf({ spans: [text('aaaa')] })]);
    // Non-overlapping scan: "aa" in "aaaa" is two matches, not three.
    expect(sd(doc, 'aa', INSENSITIVE)).toHaveLength(2);
  });

  it('searches code source, tagged as code', () => {
    const doc = docOf([
      blockOf({
        type: 'Code',
        spans: [text('const total = sum(total)')],
        payload: { kind: 'code', language: 'ts', source: 'const total = sum(total)' },
      }),
    ]);
    const matches = sd(doc, 'total', INSENSITIVE);
    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.kind === 'code' && m.backing === 'text')).toBe(true);
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe('total');
  });

  it('searches an image caption, tagged as imageAlt', () => {
    const doc = docOf([
      blockOf({
        type: 'Image',
        spans: [text('a wolf pack')],
        payload: { kind: 'image', path: 'p', alt: 'a wolf pack', width: 0, align: 'left', crop: null },
      }),
    ]);
    const matches = sd(doc, 'wolf', INSENSITIVE);
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe('imageAlt');
    expect(doc.textBetween(matches[0].from, matches[0].to)).toBe('wolf');
  });

  it('searches block-equation LaTeX as an attribute-backed match on the whole node', () => {
    const doc = docOf([
      blockOf({ type: 'Equation', spans: [], payload: { kind: 'equation', latex: 'E = mc^2' } }),
    ]);
    const matches = sd(doc, 'mc', INSENSITIVE);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      kind: 'equation',
      backing: 'attr',
      localRange: { start: 4, length: 2 },
      exactText: 'mc',
    });
    // The range is the equation node itself, so navigation and highlight target
    // the block rather than a caret position inside rendered math.
    const node = doc.nodeAt(matches[0].from);
    expect(node?.type.name).toBe('equationBlock');
    expect(matches[0].to).toBe(matches[0].from + (node?.nodeSize ?? 0));
  });

  it('keeps inline-equation LaTeX in the projection but never surfaces a hit inside the atom', () => {
    // Consistency requires the LaTeX be part of the canonical text; but there is
    // no editable document range inside a rendered inline atom, so a hit that
    // touches it must not be surfaced. This holds whether the query lands inside
    // the atom, equals the whole atom, or spans prose into it.
    const doc = docOf([blockOf({ spans: [text('energy '), equation('mc^2')] })]);
    const projection = projectDocument(doc, registry);
    expect(projection.text).toContain('mc^2');
    expect(sd(doc, 'mc', INSENSITIVE)).toEqual([]); // strictly inside the atom
    expect(sd(doc, 'mc^2', INSENSITIVE)).toEqual([]); // equals the whole atom
    expect(sd(doc, 'energy mc', INSENSITIVE)).toEqual([]); // prose into the atom
    // Prose beside the atom is still found normally.
    expect(sd(doc, 'energy', INSENSITIVE)).toHaveLength(1);
    expect(doc.textBetween(sd(doc, 'energy', INSENSITIVE)[0].from, sd(doc, 'energy', INSENSITIVE)[0].to)).toBe('energy');
  });

  it('every surfaced text-backed match holds its exact text in the real document', () => {
    const doc = docOf([blockOf({ spans: [text('alpha beta gamma')] })]);
    for (const match of sd(doc, 'a', INSENSITIVE)) {
      if (match.backing === 'text') expect(doc.textBetween(match.from, match.to)).toBe(match.exactText);
    }
  });
});

describe('stale results', () => {
  it('withIdentity tags every result with the note identity', () => {
    const doc = docOf([blockOf({ spans: [text('one two one')] })]);
    const results = withIdentity(sd(doc, 'one', INSENSITIVE), { noteSid: 'note01', ver: 7 });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.noteSid === 'note01' && r.ver === 7)).toBe(true);
  });

  it('dropStale removes results computed against a different version', () => {
    const doc = docOf([blockOf({ spans: [text('one two one')] })]);
    const results = withIdentity(sd(doc, 'one', INSENSITIVE), { noteSid: 'note01', ver: 7 });
    expect(dropStale(results, 7)).toHaveLength(2);
    expect(dropStale(results, 8)).toHaveLength(0);
  });
});

describe('projectionOf caching', () => {
  it('returns the same projection object for the same document', () => {
    const doc = docOf([blockOf({ spans: [text('cached')] })]);
    expect(projectionOf(doc, registry)).toBe(projectionOf(doc, registry));
  });

  it('projects a fresh document independently', () => {
    const first = docOf([blockOf({ spans: [text('one')] })]);
    const second = docOf([blockOf({ spans: [text('two')] })]);
    expect(projectionOf(first, registry)).not.toBe(projectionOf(second, registry));
  });
});
