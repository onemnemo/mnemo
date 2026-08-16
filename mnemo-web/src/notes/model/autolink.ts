/**
 * Detects URL-like substrings in plain text and applies the `link` mark to
 * them. Runs after every text edit, so it has to be conservative: it skips
 * code spans, spans the user explicitly unlinked (suppressAutoLink), and
 * ranges already linked to a different href, so it never fights the user's
 * own formatting choices.
 */

import { applyFormat } from './format';
import { flattenForCaret, normalizeSpans, spanCaretLength } from './spans';
import { isTextSpan, type InlineSpan } from './types';

// .NET's `\b` is Unicode-aware ([\p{L}\p{Mn}\p{Nd}\p{Pc}]), but JS `\w`/`\b`
// stay ASCII-only even under the `u` flag, so a plain `\b` here would link
// more than the C# original does (e.g. a URL glued to a non-ASCII letter
// with no separator).
//
// A `(?<![\p{L}...}])` lookbehind looks like the fix, but it isn't: under
// the `u` flag JS tests Unicode properties against full *code points*, so a
// lookbehind combines an adjacent UTF-16 surrogate pair into one astral
// character before testing it. .NET's regex engine never does that, it
// tests each UTF-16 char/category in isolation, so a lone surrogate half is
// always category Cs (never L/Mn/Nd/Pc), and a URL glued to an astral letter
// (e.g. a bold-math "𝐹" right before "www...") *does* get linked in C#. A
// lookbehind here would wrongly block that case.
//
// findUrlCandidates below tests the single preceding code unit as its own
// one-character string (`flat[i - 1]`), which can never pair with anything, 
// that reproduces .NET's per-code-unit judgment exactly, whereas a
// full-string lookbehind cannot.
const urlBodyPattern = /(?:https?|mailto):[^\s<>[\]]+|www\.[^\s<>[\]]+/iy;
const wordCharUnit = /[\p{L}\p{Mn}\p{Nd}\p{Pc}]/u;
const wwwPrefix = /^www\./i;
const trailingJunk = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '"', "'", '”', '’']);

interface UrlCandidate {
  start: number;
  end: number;
  raw: string;
}

/**
 * Scans left to right for url-like runs, retrying one UTF-16 code unit at a
 * time when the boundary check fails at a given start. That one-at-a-time
 * retry (rather than matching greedily and discarding a rejected match) is
 * what keeps this equivalent to an in-pattern `\b`/lookbehind: a rejected
 * candidate must not consume any characters, or a second, legitimately
 * boundary-satisfying URL immediately after it would be silently skipped.
 */
function findUrlCandidates(flat: string): UrlCandidate[] {
  const results: UrlCandidate[] = [];
  let i = 0;
  while (i < flat.length) {
    const prevUnit = i > 0 ? flat[i - 1] : undefined;
    if (prevUnit === undefined || !wordCharUnit.test(prevUnit)) {
      urlBodyPattern.lastIndex = i;
      const m = urlBodyPattern.exec(flat);
      if (m && m.index === i) {
        results.push({ start: i, end: i + m[0].length, raw: m[0] });
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return results;
}

export function normalizeUrl(raw: string): string {
  if (raw.trim().length === 0) return raw;
  const trimmed = raw.trim();
  return wwwPrefix.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function trimTrailingJunk(text: string): string {
  let len = text.length;
  while (len > 0 && trailingJunk.has(text[len - 1])) len--;
  return len === text.length ? text : text.slice(0, len);
}

/** True if [start, end) is already covered, edge to edge, by the same href. */
function fullyLinkedWithUrl(spans: readonly InlineSpan[], start: number, end: number, url: string): boolean {
  let any = false;
  let pos = 0;
  for (const span of spans) {
    const runEnd = pos + spanCaretLength(span);
    const segStart = Math.max(start, pos);
    const segEnd = Math.min(end, runEnd);
    if (segStart < segEnd) {
      if (!isTextSpan(span) || span.style.linkUrl == null) return false;
      if (span.style.linkUrl.toLowerCase() !== url.toLowerCase()) return false;
      any = true;
    }
    pos = runEnd;
  }
  return any;
}

function canApplyLink(spans: readonly InlineSpan[], start: number, end: number, normalizedUrl: string): boolean {
  // Already linked to this exact href, edge to edge: nothing to do.
  if (fullyLinkedWithUrl(spans, start, end, normalizedUrl)) return false;

  let pos = 0;
  for (const span of spans) {
    const runEnd = pos + spanCaretLength(span);
    const segStart = Math.max(start, pos);
    const segEnd = Math.min(end, runEnd);
    if (segStart < segEnd) {
      if (!isTextSpan(span)) return false;
      if (span.style.code) return false;
      if (span.style.suppressAutoLink) return false;
      if (span.style.linkUrl != null && span.style.linkUrl.toLowerCase() !== normalizedUrl.toLowerCase()) {
        return false;
      }
    }
    pos = runEnd;
  }
  return true;
}

export function applyAutoLink(spans: readonly InlineSpan[]): InlineSpan[] {
  if (spans.length === 0) return [];

  const flat = flattenForCaret(spans);
  if (flat.length === 0) return normalizeSpans(spans);

  const matches: { start: number; end: number; url: string }[] = [];
  for (const { start, raw } of findUrlCandidates(flat)) {
    const trimmed = trimTrailingJunk(raw);
    if (trimmed.length === 0) continue;

    const end = start + trimmed.length;
    const url = normalizeUrl(trimmed);
    if (url.length === 0) continue;
    if (!canApplyLink(spans, start, end, url)) continue;

    matches.push({ start, end, url });
  }

  if (matches.length === 0) return normalizeSpans(spans);

  // Overlapping matches can't both apply; earliest match wins.
  matches.sort((a, b) => a.start - b.start);
  const filtered: typeof matches = [];
  let lastEnd = -1;
  for (const match of matches) {
    if (match.start < lastEnd) continue;
    filtered.push(match);
    lastEnd = match.end;
  }

  // Applying in reverse keeps earlier offsets meaningful, though it does not
  // strictly matter here, applyFormat restyles in place and never shifts
  // caret positions.
  let result = normalizeSpans(spans);
  for (let i = filtered.length - 1; i >= 0; i--) {
    const { start, end, url } = filtered[i];
    result = applyFormat(result, start, end, 'link', url);
  }

  return normalizeSpans(result);
}
