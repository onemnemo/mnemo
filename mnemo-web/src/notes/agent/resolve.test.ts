import { describe, expect, it } from 'vitest';
import type { BlockEntry } from '../editor/projection/document';
import { maxCandidates, resolveRef } from './resolve';

/** Only `sid` is read, so the rest of a `BlockEntry` is irrelevant here. */
function entries(...sids: string[]): BlockEntry[] {
  return sids.map((sid) => ({ sid }) as BlockEntry);
}

describe('resolveRef', () => {
  it('resolves an exact sid', () => {
    const result = resolveRef(entries('k7m2q', 'x9tkd'), 'x9tkd');
    expect(result.ok && result.entry.sid).toBe('x9tkd');
  });

  it('resolves a unique prefix', () => {
    const result = resolveRef(entries('k7m2q', 'x9tkd'), 'x9');
    expect(result.ok && result.entry.sid).toBe('x9tkd');
  });

  it('is case insensitive', () => {
    const result = resolveRef(entries('x9tkd'), 'X9TKD');
    expect(result.ok && result.entry.sid).toBe('x9tkd');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveRef(entries('x9tkd'), '  x9tkd \n').ok).toBe(true);
  });

  it('prefers an exact match over blocks it is a prefix of', () => {
    // Only reachable through corrupt data — sids are fixed length — but the
    // fallback order is what makes an exact hit unambiguous by construction.
    const result = resolveRef(entries('x9tk', 'x9tkd'), 'x9tk');
    expect(result.ok && result.entry.sid).toBe('x9tk');
  });

  it('reports an ambiguous prefix with its candidates', () => {
    const result = resolveRef(entries('x9tkd', 'x9qrs', 'k7m2q'), 'x9');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_error');
    expect(result.error.candidates).toEqual(['x9tkd', 'x9qrs']);
    expect(result.error.message).toBe('id "x9" is ambiguous; candidates: x9tkd, x9qrs.');
  });

  it('caps the listed candidates but still states the true count', () => {
    // An unbounded list is how an ambiguity error becomes a context overflow.
    const many = Array.from({ length: maxCandidates + 5 }, (_, i) => `a${String(i).padStart(4, '0')}`);
    const result = resolveRef(entries(...many), 'a');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.candidates).toHaveLength(maxCandidates + 5);
    expect(result.error.message).toContain('and 5 more.');
    expect(result.error.message.split(', ')).toHaveLength(maxCandidates + 1);
  });

  it('treats duplicate sids as ambiguous rather than picking one', () => {
    const result = resolveRef(entries('x9tkd', 'x9tkd'), 'x9tkd');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_error');
    // Deduplicated: repeating one id as its own alternatives helps nobody.
    expect(result.error.candidates).toEqual(['x9tkd']);
  });

  it('reports an unmatched reference as not found', () => {
    const result = resolveRef(entries('x9tkd'), 'zzzzz');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
    expect(result.error.message).toBe('no block matching "zzzzz".');
  });

  it('rejects a missing or blank reference as a validation error', () => {
    for (const ref of [undefined, '', '   ']) {
      const result = resolveRef(entries('x9tkd'), ref);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toBe('block id is required.');
    }
  });
});
