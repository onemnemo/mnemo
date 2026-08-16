import { describe, expect, it } from 'vitest';

import { applyAutoLink, normalizeUrl } from './autolink';
import { flattenDisplay, plainSpan } from './spans';
import { defaultTextStyle, isTextSpan, type InlineSpan } from './types';

describe('normalizeUrl', () => {
  it('leaves a scheme-qualified url untouched', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
  });

  it('prefixes a bare www. host with https://', () => {
    expect(normalizeUrl('www.example.com')).toBe('https://www.example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com');
  });
});

describe('applyAutoLink', () => {
  it('links a plain https url found in running text', () => {
    const spans: InlineSpan[] = [plainSpan('visit https://example.com today')];
    const result = applyAutoLink(spans);
    expect(flattenDisplay(result)).toBe('visit https://example.com today');
    const linked = result.find((s) => s.kind === 'text' && s.text === 'https://example.com');
    expect(linked?.style.linkUrl).toBe('https://example.com');
  });

  it('links a bare www. host, normalizing it to https://', () => {
    const spans: InlineSpan[] = [plainSpan('see www.example.com now')];
    const result = applyAutoLink(spans);
    const linked = result.find((s) => s.kind === 'text' && s.text === 'www.example.com');
    expect(linked?.style.linkUrl).toBe('https://www.example.com');
  });

  it('trims trailing punctuation and quotes out of the matched url', () => {
    const spans: InlineSpan[] = [plainSpan('link: https://example.com/page).')];
    const result = applyAutoLink(spans);
    const linked = result.find((s) => isTextSpan(s) && s.style.linkUrl != null);
    expect(linked && isTextSpan(linked) ? linked.text : undefined).toBe('https://example.com/page');
    expect(flattenDisplay(result)).toBe('link: https://example.com/page).');
  });

  it('is a no-op when a span is already linked to the same url end to end', () => {
    const spans: InlineSpan[] = [
      plainSpan('https://example.com', { ...defaultTextStyle, linkUrl: 'https://example.com' }),
    ];
    const result = applyAutoLink(spans);
    expect(result).toEqual(spans);
  });

  it('skips a code-styled span even though it looks like a url', () => {
    const spans: InlineSpan[] = [plainSpan('https://example.com', { ...defaultTextStyle, code: true })];
    const result = applyAutoLink(spans);
    expect(result).toEqual(spans);
  });

  it('skips a span the user explicitly unlinked (suppressAutoLink)', () => {
    const spans: InlineSpan[] = [
      plainSpan('https://example.com', { ...defaultTextStyle, suppressAutoLink: true }),
    ];
    const result = applyAutoLink(spans);
    expect(result).toEqual(spans);
  });

  it('skips a span already linked to a different url', () => {
    const spans: InlineSpan[] = [
      plainSpan('https://example.com', { ...defaultTextStyle, linkUrl: 'https://other.com' }),
    ];
    const result = applyAutoLink(spans);
    expect(result).toEqual([plainSpan('https://example.com', { ...defaultTextStyle, linkUrl: 'https://other.com' })]);
  });

  it('is a no-op on text with no url-like substring', () => {
    const spans: InlineSpan[] = [plainSpan('just some plain text')];
    expect(applyAutoLink(spans)).toEqual(spans);
  });

  it('returns [] for an empty span list', () => {
    expect(applyAutoLink([])).toEqual([]);
  });

  it('links multiple distinct urls in the same block', () => {
    const spans: InlineSpan[] = [plainSpan('go to https://a.com or https://b.com')];
    const result = applyAutoLink(spans);
    const urls = result.filter(isTextSpan).filter((s) => s.style.linkUrl != null).map((s) => s.text);
    expect(urls).toEqual(['https://a.com', 'https://b.com']);
  });

  it('two url-like matches separated only by an excluded bracket char both link, adjacent but not overlapping', () => {
    // The url character class excludes `<>[]`, so a bracket splits what would
    // otherwise be one greedy match into two adjacent (touching, not
    // overlapping) candidates. Genuine index-overlap between two matches from
    // a single left-to-right regex pass cannot occur -- the overlap-skip in
    // applyAutoLink is defensive dead code under the current pattern -- so
    // this is the closest reachable exercise of that filtering path.
    const spans: InlineSpan[] = [plainSpan('https://a.com]https://b.com')];
    const result = applyAutoLink(spans);
    const urls = result.filter(isTextSpan).filter((s) => s.style.linkUrl != null).map((s) => s.text);
    expect(urls).toEqual(['https://a.com', 'https://b.com']);
  });

  it('an atom in the middle of an otherwise-matching range blocks linking entirely', () => {
    // The url char class doesn't exclude the caret-space atom placeholder, so
    // a URL glued directly to a trailing atom (no separator) produces one
    // candidate range spanning both. canApplyLink then finds a non-text span
    // inside that range and rejects the whole candidate -- an atom can't be
    // partially linked, so it blocks its neighbor too.
    const spans: InlineSpan[] = [
      plainSpan('see https://a.com'),
      { kind: 'equation', latex: 'e', style: defaultTextStyle },
    ];
    const result = applyAutoLink(spans);
    expect(result).toEqual(spans);
  });

  it('does not link a url glued to a non-ASCII letter with no separator (matches .NET word-boundary behavior)', () => {
    // .NET's `\b` is Unicode-aware, so "Åhttps://x.com" is not a boundary
    // there either -- the port must not link more than the original did.
    const spans: InlineSpan[] = [plainSpan('Åhttps://x.com')];
    const result = applyAutoLink(spans);
    expect(result.every((s) => s.kind === 'text' && s.style.linkUrl == null)).toBe(true);
    expect(flattenDisplay(result)).toBe('Åhttps://x.com');
  });

  it('still links a url preceded by an ASCII space, unaffected by the boundary fix', () => {
    const spans: InlineSpan[] = [plainSpan('see https://x.com')];
    const result = applyAutoLink(spans);
    const linked = result.find((s) => isTextSpan(s) && s.style.linkUrl != null);
    expect(linked && isTextSpan(linked) ? linked.text : undefined).toBe('https://x.com');
  });
});
