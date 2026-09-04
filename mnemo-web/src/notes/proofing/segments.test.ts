/**
 * What leaves the app, and what does not.
 *
 * The skip rules are the half of proofing that has no visible failure: a
 * dictionary handed `\frac` or `npm instal` answers with issues that are all
 * correct and all useless, and the note fills with red under source the user
 * never wrote as prose.
 */

import { describe, expect, it } from 'vitest';

import {
  blockOf,
  codeText,
  docOf,
  equation,
  fraction,
  linkText,
  registry,
  tableOf,
  text,
} from './fixtures';
import { checkableSegments, hashText } from './segments';

describe('checkableSegments', () => {
  it('addresses a segment by its block short id and its index in the block', () => {
    const doc = docOf([blockOf({ sid: 'aaa', spans: [text('one two')] })]);
    expect(checkableSegments(doc, registry).map((segment) => segment.id)).toEqual(['aaa:0']);
  });

  it('blanks an inline code span, keeping every later offset where it was', () => {
    const doc = docOf([
      blockOf({ sid: 'aaa', spans: [text('run '), codeText('npm instal'), text(' twice')] }),
    ]);
    const [segment] = checkableSegments(doc, registry);
    expect(segment.text).toBe('run            twice');
    expect(segment.text.length).toBe('run npm instal twice'.length);
    expect(segment.text.indexOf('twice')).toBe('run npm instal twice'.indexOf('twice'));
  });

  it('blanks an inline equation and an inline fraction, which project as their source', () => {
    const doc = docOf([
      blockOf({ sid: 'aaa', spans: [text('so '), equation('\\frac{a}{b}'), text(' holds')] }),
      blockOf({ sid: 'bbb', spans: [text('and '), fraction(3, 4), text(' too')] }),
    ]);
    const segments = checkableSegments(doc, registry);
    expect(segments[0].text).not.toContain('frac');
    expect(segments[0].text).toBe(`so ${' '.repeat('\\frac{a}{b}'.length)} holds`);
    expect(segments[1].text).toBe(`and ${' '.repeat('3/4'.length)} too`);
  });

  it('checks link text, which is prose that happens to point somewhere', () => {
    const doc = docOf([
      blockOf({ sid: 'aaa', spans: [text('see '), linkText('the guide', 'https://example.com')] }),
    ]);
    expect(checkableSegments(doc, registry)[0].text).toBe('see the guide');
  });

  it('skips source, a block equation and anything with nothing left after blanking', () => {
    const doc = docOf([
      blockOf({
        sid: 'code',
        type: 'Code',
        spans: [],
        payload: { kind: 'code', language: 'ts', source: 'const teh = 1' },
      }),
      blockOf({
        sid: 'eq',
        type: 'Equation',
        spans: [],
        payload: { kind: 'equation', latex: '\\alpha' },
      }),
      blockOf({ sid: 'only-code', spans: [codeText('npm instal')] }),
      blockOf({ sid: 'prose', spans: [text('real words')] }),
    ]);
    expect(checkableSegments(doc, registry).map((segment) => segment.sid)).toEqual(['prose']);
  });

  it('reaches a nested list child, a table cell and an image caption', () => {
    const doc = docOf([
      blockOf({
        sid: 'outer',
        type: 'BulletList',
        spans: [text('outer item')],
        children: [blockOf({ sid: 'inner', type: 'BulletList', spans: [text('inner item')] })],
      }),
      tableOf([['cell one', 'cell two']], 'tbl'),
      blockOf({
        sid: 'img',
        type: 'Image',
        spans: [text('a wolf pack')],
        payload: { kind: 'image', path: 'p', alt: 'a wolf pack', width: 0, align: 'left', crop: null },
      }),
    ]);

    const sids = checkableSegments(doc, registry).map((segment) => segment.sid);
    expect(sids).toContain('outer');
    expect(sids).toContain('inner');
    expect(sids).toContain('tbl-c00');
    expect(sids).toContain('tbl-c01');
    expect(sids).toContain('img');
  });

  it('gives the same text the same hash and different text a different one', () => {
    expect(hashText('recieve')).toBe(hashText('recieve'));
    expect(hashText('recieve')).not.toBe(hashText('receive'));
  });
});
