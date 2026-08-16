/**
 * `InlineSpan[]` -> inline markdown, the inverse of `parseInlineMarkdown`.
 *
 * A faithful port of Mnemo.Infrastructure's `InlineMarkdownSerializer` so a note
 * copied here reads back the same as one copied on the desktop: the two apps
 * share the wire span model, so serializing over `InlineSpan` rather than over
 * ProseMirror marks keeps the clipboard dialect identical on both sides.
 *
 * Only the styles markdown can express survive the trip: bold, italic,
 * strikethrough, code and links. Underline, highlight, sub/sup and colours have
 * no markdown form and are dropped here exactly as the desktop drops them, which
 * is why this is the *fallback* representation and the exact same-app path
 * carries the ProseMirror slice instead.
 */

import { isTextSpan, type InlineSpan, type TextSpan } from './types';

/** Matches an already-formed image run so escaping leaves embedded images intact. */
const embeddedImage = /!\[[^\]]*\]\([^)]+\)(?:\{align=(?:left|center|right)\})?/gi;

/** Characters that would otherwise be read as markdown control syntax in literal text. */
const markdownSpecials = new Set(['\\', '*', '_', '~', '`', '[', ']']);

export function serializeInlineMarkdown(spans: readonly InlineSpan[]): string {
  let out = '';
  for (const span of spans) out += serializeSpan(span);
  return out;
}

function serializeSpan(span: InlineSpan): string {
  switch (span.kind) {
    case 'equation':
      return `$${span.latex}$`;
    case 'fraction':
      return `\\${span.numerator}/${span.denominator}`;
    default:
      return isTextSpan(span) ? serializeTextSpan(span) : '';
  }
}

function serializeTextSpan(span: TextSpan): string {
  if (span.text.length === 0) return '';

  const style = span.style;
  if (style.code) return serializeCodeSpan(span.text);

  let out = escapePreservingEmbeddedImages(span.text);
  if (style.bold && style.italic) out = `***${out}***`;
  else if (style.bold) out = `**${out}**`;
  else if (style.italic) out = `*${out}*`;
  if (style.strikethrough) out = `~~${out}~~`;
  if (style.linkUrl) out = `[${out}](${escapeLinkDestination(style.linkUrl)})`;
  return out;
}

/**
 * A code span is fenced by one more backtick than its longest internal run, with
 * a space of padding when it contains any backtick at all, so the delimiters can
 * never collide with the content.
 */
function serializeCodeSpan(text: string): string {
  const maxRun = maxConsecutiveBackticks(text);
  const fence = '`'.repeat(maxRun + 1);
  const pad = maxRun > 0 ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function maxConsecutiveBackticks(text: string): number {
  let max = 0;
  let run = 0;
  for (const ch of text) {
    if (ch === '`') {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 0;
    }
  }
  return max;
}

function escapeLinkDestination(url: string): string {
  return url.replaceAll('\\', '\\\\').replaceAll(')', '\\)');
}

/** Backslash-escapes markdown control characters; newlines are kept verbatim. */
export function escapeMarkdownText(text: string): string {
  if (text.length === 0) return text;
  let out = '';
  for (const ch of text) out += markdownSpecials.has(ch) ? `\\${ch}` : ch;
  return out;
}

/**
 * Escapes literal text but leaves any `![alt](path)` run it contains untouched,
 * so an image already written in markdown is not mangled by escaping its
 * brackets and parentheses.
 */
function escapePreservingEmbeddedImages(text: string): string {
  if (text.length === 0) return text;

  embeddedImage.lastIndex = 0;
  const matches = [...text.matchAll(embeddedImage)];
  if (matches.length === 0) return escapeMarkdownText(text);

  let out = '';
  let cursor = 0;
  for (const match of matches) {
    const at = match.index ?? 0;
    if (at > cursor) out += escapeMarkdownText(text.slice(cursor, at));
    out += match[0];
    cursor = at + match[0].length;
  }
  if (cursor < text.length) out += escapeMarkdownText(text.slice(cursor));
  return out;
}
