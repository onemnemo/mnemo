/**
 * That the colour lands on the characters it was computed for.
 *
 * A tokenizer test can only say the offsets partition the text. What this says is
 * that the offsets are translated into the right document positions, which is
 * where a code block's decorations actually go wrong: the block opens at one
 * position, its line at another, and being one out paints every keyword one
 * character to the left.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { Decoration } from 'prosemirror-view';

import { createEditorSchema } from '../schema';
import { codeHighlightDecorations } from './highlight';

const { schema } = createEditorSchema();

function codeLine(source: string): PMNode {
  return schema.nodes.codeLine.create(null, source.length > 0 ? schema.text(source) : null);
}

function docWith(blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function paragraph(text: string): PMNode {
  return schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text(text)));
}

function codeBlock(source: string, language = 'typescript'): PMNode {
  return schema.nodes.codeBlock.create({ language }, codeLine(source));
}

/** The class an inline decoration carries. `type` is internal, hence the cast. */
const classOf = (deco: Decoration): string =>
  (deco as unknown as { type: { attrs: { class: string } } }).type.attrs.class;

/** What each decoration actually covers, read back out of the document. */
function painted(doc: PMNode): [string, string][] {
  return codeHighlightDecorations(doc).map((deco) => [
    doc.textBetween(deco.from, deco.to),
    classOf(deco),
  ]);
}

describe('codeHighlightDecorations', () => {
  it('paints each token over its own characters', () => {
    expect(painted(docWith([paragraph('before'), codeBlock('const answer = 42;')]))).toEqual([
      ['const', 'notes-tok-key'],
      // The assignment sign and the semicolon are structure, so they dim.
      ['=', 'notes-tok-punc'],
      ['42', 'notes-tok-num'],
      [';', 'notes-tok-punc'],
    ]);
  });

  it('is unaffected by how much document sits above the block', () => {
    const near = docWith([paragraph('a'), codeBlock('const a = 1;')]);
    const far = docWith([paragraph('a much longer paragraph'), paragraph('and another'), codeBlock('const a = 1;')]);
    expect(painted(far)).toEqual(painted(near));
  });

  it('colours every code block in the document', () => {
    const doc = docWith([codeBlock('const a = 1;'), paragraph('between'), codeBlock('let b = 2;')]);
    expect(painted(doc).filter(([, cls]) => cls === 'notes-tok-key')).toEqual([
      ['const', 'notes-tok-key'],
      ['let', 'notes-tok-key'],
    ]);
  });

  it('draws nothing for a language with no parts worth colouring', () => {
    expect(codeHighlightDecorations(docWith([codeBlock('const a = 1;', 'text')]))).toEqual([]);
  });

  it('draws nothing for an empty block', () => {
    expect(codeHighlightDecorations(docWith([codeBlock('')]))).toEqual([]);
  });

  it('re-reads the grammar when the language changes under the same line', () => {
    // The one node both blocks share is exactly what the cache is keyed on, so a
    // cache that ignored the language would hand the second block the first
    // one's colours. SQL calls `select` a keyword and JSON does not.
    const shared = codeLine('select * from t');
    const asSql = codeHighlightDecorations(
      docWith([schema.nodes.codeBlock.create({ language: 'sql' }, shared)]),
    );
    const asJson = codeHighlightDecorations(
      docWith([schema.nodes.codeBlock.create({ language: 'json' }, shared)]),
    );
    expect(asSql.some((deco) => classOf(deco) === 'notes-tok-key')).toBe(true);
    expect(asJson.some((deco) => classOf(deco) === 'notes-tok-key')).toBe(false);
  });

  it('leaves a line holding an inline atom uncoloured rather than misaligned', () => {
    // An atom projects many characters of LaTeX while occupying one position, so
    // token offsets and PM positions stop being related by addition.
    const line = schema.nodes.codeLine.create(null, [
      schema.text('const a = '),
      schema.nodes.equationSpan.create({ latex: 'x^2' }),
    ]);
    expect(codeHighlightDecorations(docWith([schema.nodes.codeBlock.create({ language: 'typescript' }, line)]))).toEqual([]);
  });
});
