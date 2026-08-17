/**
 * Syntax highlighting, small enough to read.
 *
 * A real highlighter is a parser per language and about a megabyte of them. A
 * note is not an IDE: what a snippet in a revision note has to do is separate
 * the parts you skim (punctuation, comments) from the parts you look up (names,
 * literals). Six colours does that, and a full grammar does not do it noticeably
 * better at eight lines of code.
 *
 * So one lexer, parameterised. Languages without their own entry fall back to
 * the C-like grammar, which is honest for roughly two thirds of the list and
 * wrong only about which words are keywords.
 *
 * No React, no DOM: this returns tokens, and the decoration plugin turns them
 * into marks. That keeps the tokenizer testable as a pure function and lets the
 * same output feed an export path later.
 */

export type TokenKind = 'key' | 'str' | 'num' | 'com' | 'fn' | 'punc' | 'plain';

export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
}

interface Grammar {
  readonly keywords: readonly string[];
  /** Line comment openers. */
  readonly line: readonly string[];
  /** Block comment delimiters. */
  readonly block?: readonly [string, string];
  /** String delimiters, each closed by itself. */
  readonly strings: readonly string[];
}

const cLike =
  'break case catch class const continue default do else enum export extends finally for function if implements import in instanceof interface let new package private protected public return static super switch this throw try typeof var void while yield async await null true false';

const grammars: Readonly<Record<string, Grammar>> = {
  javascript: {
    keywords: `${cLike} of delete undefined NaN`.split(' '),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'", '`'],
  },
  typescript: {
    keywords:
      `${cLike} of type namespace declare readonly keyof as satisfies infer never unknown any string number boolean`.split(
        ' ',
      ),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'", '`'],
  },
  csharp: {
    keywords:
      `${cLike} abstract as base bool byte checked decimal delegate double event explicit fixed float foreach get goto implicit int internal is lock long namespace object operator out override params readonly ref sbyte sealed set short sizeof stackalloc string struct uint ulong unchecked unsafe ushort using value virtual volatile when where record init nameof`.split(
        ' ',
      ),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  python: {
    keywords:
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self'.split(
        ' ',
      ),
    line: ['#'],
    // Triple quotes come first so a docstring is one string rather than three
    // empty ones: the lexer tries delimiters in the order they are listed.
    strings: ['"""', "'''", '"', "'"],
  },
  rust: {
    keywords:
      'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(
        ' ',
      ),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"'],
  },
  go: {
    keywords:
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(
        ' ',
      ),
    line: ['//'],
    block: ['/*', '*/'],
    strings: ['"', '`'],
  },
  sql: {
    keywords:
      'select from where group by having order limit offset join left right inner outer full on as insert into values update set delete create table alter drop index view distinct union all and or not null is like between case when then else end count sum avg min max'.split(
        ' ',
      ),
    line: ['--'],
    block: ['/*', '*/'],
    strings: ["'", '"'],
  },
  bash: {
    keywords:
      'if then else elif fi for while do done case esac function return export local source echo cd ls rm mv cp mkdir sudo exit set unset read'.split(
        ' ',
      ),
    line: ['#'],
    strings: ['"', "'"],
  },
  powershell: {
    keywords:
      'if elseif else switch foreach for while do until break continue return function param begin process end try catch finally throw filter class enum using in -eq -ne -gt -lt -ge -le -and -or -not'.split(
        ' ',
      ),
    line: ['#'],
    block: ['<#', '#>'],
    strings: ['"', "'"],
  },
  ruby: {
    keywords:
      'def end class module if elsif else unless while until for in do then begin rescue ensure raise return yield self nil true false and or not require attr_accessor puts lambda proc'.split(
        ' ',
      ),
    line: ['#'],
    strings: ['"', "'"],
  },
  json: { keywords: ['true', 'false', 'null'], line: [], strings: ['"'] },
  yaml: { keywords: ['true', 'false', 'null', 'yes', 'no'], line: ['#'], strings: ['"', "'"] },
  toml: { keywords: ['true', 'false'], line: ['#'], strings: ['"', "'"] },
  css: {
    keywords:
      'important media supports keyframes from to and not only screen print var calc rgb oklch hsl'.split(
        ' ',
      ),
    line: [],
    block: ['/*', '*/'],
    strings: ['"', "'"],
  },
  r: {
    keywords:
      'if else repeat while function for in next break TRUE FALSE NULL Inf NaN NA library require return'.split(
        ' ',
      ),
    line: ['#'],
    strings: ['"', "'"],
  },
  matlab: {
    keywords:
      'function end if elseif else while for switch case otherwise break continue return global persistent try catch'.split(
        ' ',
      ),
    line: ['%'],
    strings: ["'", '"'],
  },
};

const generic: Grammar = {
  keywords: cLike.split(' '),
  line: ['//', '#'],
  block: ['/*', '*/'],
  strings: ['"', "'"],
};

/** Whole-language opt-out: plain text has no parts worth colouring. */
const plainLanguages: ReadonlySet<string> = new Set(['text', 'diff', '']);

const escape = (source: string): string => source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One pass, one regex.
 *
 * Order is the whole grammar: comments before strings before numbers before
 * words, because `"// not a comment"` is a string and `#include` is not a
 * number. Anything the regex does not claim is plain text, and punctuation is
 * picked out of that afterwards.
 */
interface Lexer {
  readonly re: RegExp;
  readonly kinds: readonly (TokenKind | 'word')[];
}

const lexerCache = new Map<string, Lexer>();

function lexerFor(grammar: Grammar): Lexer {
  const key = JSON.stringify([grammar.line, grammar.block, grammar.strings]);
  const cached = lexerCache.get(key);
  if (cached) return cached;

  const parts: { src: string; kind: TokenKind | 'word' }[] = [];
  // Unterminated openers still colour to the end of the snippet: code in a note
  // is very often a fragment, and half a highlighted comment reads as a bug in
  // the highlighter rather than as a truncated quotation.
  if (grammar.block) {
    parts.push({
      src: `${escape(grammar.block[0])}[\\s\\S]*?(?:${escape(grammar.block[1])}|$)`,
      kind: 'com',
    });
  }
  if (grammar.line.length > 0) {
    parts.push({ src: `(?:${grammar.line.map(escape).join('|')})[^\\n]*`, kind: 'com' });
  }
  if (grammar.strings.length > 0) {
    parts.push({
      src: grammar.strings
        .map((delimiter) => `${escape(delimiter)}(?:\\\\.|[\\s\\S])*?(?:${escape(delimiter)}|$)`)
        .join('|'),
      kind: 'str',
    });
  }
  parts.push({ src: '0[xXbo][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?', kind: 'num' });
  parts.push({ src: '[A-Za-z_$][\\w$]*', kind: 'word' });

  // One capture group per alternative, so the index of the group that matched is
  // the kind, with no second pass to work out what fired.
  const made: Lexer = {
    re: new RegExp(parts.map((part) => `(${part.src})`).join('|'), 'g'),
    kinds: parts.map((part) => part.kind),
  };
  lexerCache.set(key, made);
  return made;
}

/** True when the language has nothing worth colouring, so callers can skip the walk. */
export function isPlainLanguage(language: string): boolean {
  return plainLanguages.has(language);
}

export function tokenize(code: string, language: string): readonly Token[] {
  if (isPlainLanguage(language)) return code.length > 0 ? [{ text: code, kind: 'plain' }] : [];

  const grammar = grammars[language] ?? generic;
  const words = new Set(grammar.keywords);
  const { re, kinds } = lexerFor(grammar);

  const out: Token[] = [];
  const pushPlain = (text: string): void => {
    // Punctuation is dimmed rather than left at full ink: brackets and commas
    // are structure, and structure should not compete with names.
    for (const part of text.split(/([^\w\s]+)/)) {
      if (part) out.push({ text: part, kind: /[^\w\s]/.test(part) ? 'punc' : 'plain' });
    }
  };

  let at = 0;
  re.lastIndex = 0;
  for (let match = re.exec(code); match; match = re.exec(code)) {
    if (match.index > at) pushPlain(code.slice(at, match.index));

    const text = match[0];
    const groupIndex = kinds.findIndex((_kind, index) => match[index + 1] !== undefined);
    const kind = groupIndex >= 0 ? kinds[groupIndex] : 'plain';

    if (kind !== 'word') out.push({ text, kind });
    else if (words.has(text)) out.push({ text, kind: 'key' });
    // A name with a bracket after it is being called, which is the one thing
    // worth picking out of an ocean of identifiers.
    else out.push({ text, kind: code[re.lastIndex] === '(' ? 'fn' : 'plain' });

    at = re.lastIndex;
    // A zero-width match would spin forever. Only reachable from a pathological
    // grammar, but the guard is one line.
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  if (at < code.length) pushPlain(code.slice(at));

  return out;
}
