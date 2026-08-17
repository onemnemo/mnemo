/**
 * The tokenizer's contract: the order the grammar is applied in, and the fact
 * that it never loses a character.
 *
 * The second half is the one that matters. Tokens are turned into decorations by
 * offset, so a lexer that drops or duplicates a byte does not produce slightly
 * wrong colour, it produces colour on the wrong text from that point to the end
 * of the block.
 */

import { describe, expect, it } from 'vitest';

import { codeLanguageLabel, codeLanguages } from './languages';
import { isPlainLanguage, tokenize, type TokenKind } from './syntax';

const kinds = (code: string, language: string): [string, TokenKind][] =>
  tokenize(code, language).map((token) => [token.text, token.kind]);

const joined = (code: string, language: string): string =>
  tokenize(code, language)
    .map((token) => token.text)
    .join('');

describe('tokenize', () => {
  it('partitions the source without gaps or duplication', () => {
    const samples: [string, string][] = [
      ['const x = "hi"; // done\n', 'typescript'],
      ['def f(a):\n    return """doc""" + a  # tail\n', 'python'],
      ['SELECT * FROM t WHERE a = \'b\' -- note', 'sql'],
      ['/* unterminated', 'javascript'],
      ['plain words with no grammar at all', 'kotlin'],
      ['', 'typescript'],
      ['\n\n', 'go'],
    ];
    for (const [code, language] of samples) {
      expect(joined(code, language)).toBe(code);
    }
  });

  it('reads a comment opener inside a string as string, not comment', () => {
    expect(kinds('const a = "// not a comment";', 'typescript')).toContainEqual([
      '"// not a comment"',
      'str',
    ]);
  });

  it('colours to the end of the block when an opener is never closed', () => {
    // Code in a note is very often a fragment, and half a highlighted comment
    // reads as a bug in the highlighter.
    expect(kinds('/* still going', 'javascript')).toEqual([['/* still going', 'com']]);
  });

  it('picks out a call but leaves a bare name plain', () => {
    const out = kinds('render(value)', 'typescript');
    expect(out).toContainEqual(['render', 'fn']);
    expect(out).toContainEqual(['value', 'plain']);
  });

  it('dims punctuation rather than leaving it at full ink', () => {
    expect(kinds('a, b', 'typescript')).toContainEqual([',', 'punc']);
  });

  it('reads a python docstring as one string rather than three empty ones', () => {
    expect(kinds('"""doc"""', 'python')).toEqual([['"""doc"""', 'str']]);
  });

  it('falls back to the C-like grammar for a language with no entry of its own', () => {
    // Honest for roughly two thirds of the list, and wrong only about which
    // words are keywords.
    expect(kinds('if (x) { }', 'kotlin')).toContainEqual(['if', 'key']);
  });

  it('leaves plain languages entirely alone', () => {
    expect(isPlainLanguage('text')).toBe(true);
    expect(tokenize('anything at all', 'text')).toEqual([{ text: 'anything at all', kind: 'plain' }]);
  });

  it('treats an unset language as plain rather than guessing a grammar', () => {
    expect(isPlainLanguage('')).toBe(true);
  });
});

describe('the language list', () => {
  it('has no duplicate values, since a value is what a note stores', () => {
    const values = codeLanguages.map((language) => language.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('shows an unknown stored value rather than claiming it is plain text', () => {
    expect(codeLanguageLabel('zig')).toBe('zig');
    expect(codeLanguageLabel('csharp')).toBe('C#');
    expect(codeLanguageLabel('')).toBe('Plain text');
  });
});
