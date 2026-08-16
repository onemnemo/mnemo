// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DOMParser as PMDOMParser } from 'prosemirror-model';

import { createEditorSchema } from './index';

const { schema } = createEditorSchema();
const parser = PMDOMParser.fromSchema(schema);

function parseHtml(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return parser.parse(el);
}

/**
 * A line's text can hold real newlines, a quote soft-wraps by storing `\n`,
 * and the editor re-parses its own DOM after every browser text mutation. If
 * the line rule collapsed whitespace, the first character typed after a soft
 * wrap would fold the new row back into the first.
 */
describe('line whitespace on DOM read-back', () => {
  it('preserves a newline inside our own line element', () => {
    const doc = parseHtml('<blockquote><div data-line="">one\ntwo</div></blockquote>');
    expect(doc.firstChild!.type.name).toBe('quote');
    expect(doc.firstChild!.textContent).toBe('one\ntwo');
  });

  it('preserves a newline mid-typing, the flip-back regression', () => {
    // The exact DOM Chrome produces typing "x" after a soft wrap.
    const doc = parseHtml('<blockquote><div data-line="">A quoted line\nx</div></blockquote>');
    expect(doc.firstChild!.textContent).toBe('A quoted line\nx');
  });

  it('still collapses whitespace in external HTML', () => {
    // No [data-line] wrapper: pasted foreign markup keeps ordinary handling.
    const doc = parseHtml('<p>one\ntwo</p>');
    expect(doc.firstChild!.textContent).toBe('one two');
  });
});
