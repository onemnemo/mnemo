// @vitest-environment node

/**
 * The caret-anchored token reader, over a headless state built from the real
 * schema so an inline atom and a source line are the genuine article.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { readToken, type TokenReader } from './caret-token';

const { schema } = createEditorSchema();

const SLASH: TokenReader = { trigger: '/', spaces: true };
const BACKSLASH: TokenReader = { trigger: '\\', spaces: false };

function text(value: string): PMNode {
  return schema.text(value);
}
function equation(latex: string): PMNode {
  return schema.nodes.equationSpan.create({ latex });
}
function paragraph(...content: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, schema.nodes.line.create(null, content));
}
function codeBlock(source: string): PMNode {
  return schema.nodes.codeBlock.create(null, schema.nodes.codeLine.create(null, text(source)));
}

/** A one-block document with the caret `offset` positions into its line. */
function stateAt(block: PMNode, offset: number, head?: number): EditorState {
  const doc = schema.nodes.doc.create(null, block);
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 2 + offset, head === undefined ? undefined : 2 + head),
  });
}

/** The caret at the end of a plain line holding `line`. */
function typed(line: string): EditorState {
  return stateAt(line.length > 0 ? paragraph(text(line)) : paragraph(), line.length);
}

describe('where a token may begin', () => {
  it('at the start of the line', () => {
    expect(readToken(typed('/quo'), SLASH)).toEqual({ from: 2, to: 6, query: 'quo' });
  });

  it('after a space, anywhere in the line', () => {
    expect(readToken(typed('hello /quo'), SLASH)).toEqual({ from: 8, to: 12, query: 'quo' });
  });

  it('after an opening bracket', () => {
    expect(readToken(typed('(\\alpha'), BACKSLASH)?.query).toBe('alpha');
    expect(readToken(typed('[/quo'), SLASH)?.query).toBe('quo');
    expect(readToken(typed('{\\beta'), BACKSLASH)?.query).toBe('beta');
  });

  /**
   * An atom contributes no text, so the reader stands one placeholder in for
   * it and the token after it measures correctly against the caret.
   */
  it('after an inline atom', () => {
    const state = stateAt(paragraph(text('E = '), equation('mc^2'), text('\\alpha')), 11);
    expect(readToken(state, BACKSLASH)).toEqual({ from: 7, to: 13, query: 'alpha' });
  });

  it('never after a letter or a digit', () => {
    expect(readToken(typed('and/or'), SLASH)).toBeNull();
    expect(readToken(typed('x2\\pi'), BACKSLASH)).toBeNull();
  });

  it('never after punctuation, so a path stays a path', () => {
    expect(readToken(typed('C:\\Users'), BACKSLASH)).toBeNull();
    expect(readToken(typed('http:/'), SLASH)).toBeNull();
    expect(readToken(typed('a=\\b'), BACKSLASH)).toBeNull();
  });
});

describe('where a token ends', () => {
  it('a slash query runs on across spaces', () => {
    expect(readToken(typed('/heading 3'), SLASH, 2)?.query).toBe('heading 3');
    // Found from the caret as well, which is how a trigger is located before it is armed.
    expect(readToken(typed('/heading 3'), SLASH)).toEqual({ from: 2, to: 12, query: 'heading 3' });
  });

  it('the token being typed is the last one, not the first', () => {
    expect(readToken(typed('\\alpha \\beta'), BACKSLASH)).toEqual({ from: 9, to: 14, query: 'beta' });
  });

  it('a backslash token ends at a space', () => {
    expect(readToken(typed('\\frac x'), BACKSLASH, 2)).toBeNull();
    expect(readToken(typed('\\frac'), BACKSLASH, 2)?.query).toBe('frac');
  });

  it('an atom inside the token ends it', () => {
    const state = stateAt(paragraph(text('\\a'), equation('x'), text('b')), 4);
    expect(readToken(state, BACKSLASH, 2)).toBeNull();
  });

  it('the caret is where the token ends, whatever follows it in the line', () => {
    const state = stateAt(paragraph(text('/quo trailing')), 4);
    expect(readToken(state, SLASH)).toEqual({ from: 2, to: 6, query: 'quo' });
  });
});

describe('reading from an armed position', () => {
  it('reads the query after that position', () => {
    expect(readToken(typed('see /quo'), SLASH, 6)).toEqual({ from: 6, to: 10, query: 'quo' });
  });

  it('refuses a position that no longer holds the trigger', () => {
    expect(readToken(typed('see xquo'), SLASH, 6)).toBeNull();
  });

  it('refuses a position the caret is no longer past', () => {
    const state = stateAt(paragraph(text('see /quo')), 4);
    expect(readToken(state, SLASH, 6)).toBeNull();
    expect(readToken(state, SLASH, 7)).toBeNull();
  });

  it('refuses a position outside the caret line', () => {
    const doc = schema.nodes.doc.create(null, [paragraph(text('/one')), paragraph(text('/two'))]);
    const secondLine = doc.child(0).nodeSize + 2;
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, secondLine + 4),
    });
    expect(readToken(state, SLASH, 2)).toBeNull();
    expect(readToken(state, SLASH, secondLine)?.query).toBe('two');
  });
});

describe('refusals', () => {
  it('a range selection is the user selecting text, not typing a command', () => {
    expect(readToken(stateAt(paragraph(text('/quo')), 0, 4), SLASH)).toBeNull();
  });

  it('a source line, where both characters are ordinary content', () => {
    expect(readToken(stateAt(codeBlock('/usr'), 4), SLASH)).toBeNull();
    expect(readToken(stateAt(codeBlock('\\n'), 2), BACKSLASH)).toBeNull();
  });

  it('a line that holds no token at all', () => {
    expect(readToken(typed('hello'), SLASH)).toBeNull();
    expect(readToken(typed(''), SLASH)).toBeNull();
  });
});
