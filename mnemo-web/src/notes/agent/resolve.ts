/**
 * Resolving a model-supplied block reference to a real block.
 *
 * **This deliberately targets `sid`, and the C# tool layer it replaces targets
 * the first 8 characters of the GUID `Id`.** An earlier migration minted a sid on every block
 * and documented it as the only identifier that crosses the model boundary, but
 * `NoteBlockTree.TryLocate` was never moved onto it, so today's tools still
 * quote GUID fragments at the model. Resolving by sid here is the point of
 * having minted them; the divergence closes when the C# path is retired, and
 * until then the two surfaces address blocks differently by design rather than
 * by accident.
 *
 * The resolution *shape* is ported faithfully — exact match first, then unique
 * prefix, then an ambiguity error carrying candidates — because that is a
 * contract the model has been trained against by the tool descriptions, and
 * because it degrades well: a truncated id gets a list to choose from instead
 * of a wrong block.
 */

import type { BlockEntry } from '../editor/projection/document';

/**
 * Mirrors the C# tool result codes so a caller can map an op failure onto the
 * existing `ToolInvocationResult` vocabulary without a translation table.
 *
 * Ambiguity is a `validation_error` rather than a `not_found` — the reference
 * matched, it just did not identify one block, and the model's correct response
 * is to send a longer id rather than to conclude the block is gone.
 */
export type ResolveErrorCode = 'validation_error' | 'not_found';

export interface ResolveError {
  readonly code: ResolveErrorCode;
  readonly message: string;
  /** Present only for an ambiguous reference. */
  readonly candidates?: readonly string[];
}

export type ResolveResult =
  | { readonly ok: true; readonly entry: BlockEntry }
  | { readonly ok: false; readonly error: ResolveError };

/**
 * How many candidate sids an ambiguity error lists.
 *
 * The C# resolver returns every match, unbounded. On the corpus that is
 * harmless, but the same code path on a large note answers a one-character
 * reference with thousands of ids — a reply that can exhaust the model's
 * context in a single tool result, which is a worse failure than the ambiguity
 * it is reporting. The count is always stated, so a truncated list still tells
 * the model the reference was far too short.
 */
export const maxCandidates = 10;

export function resolveRef(blocks: readonly BlockEntry[], ref: string | undefined): ResolveResult {
  const key = (ref ?? '').trim().toLowerCase();
  if (key.length === 0) {
    return { ok: false, error: { code: 'validation_error', message: 'block id is required.' } };
  }

  // The sid alphabet is lowercase by construction, so lowercasing the reference
  // is enough to make this case-insensitive without widening what can match.
  const exact = blocks.filter((b) => b.sid.toLowerCase() === key);
  if (exact.length === 1) return { ok: true, entry: exact[0] };

  const prefix = blocks.filter((b) => b.sid.toLowerCase().startsWith(key));
  if (prefix.length === 1) return { ok: true, entry: prefix[0] };

  if (prefix.length > 1) {
    const all = [...new Set(prefix.map((b) => b.sid))];
    const shown = all.slice(0, maxCandidates);
    const suffix = all.length > shown.length ? `, and ${String(all.length - shown.length)} more` : '';
    return {
      ok: false,
      error: {
        code: 'validation_error',
        message: `id "${key}" is ambiguous; candidates: ${shown.join(', ')}${suffix}.`,
        candidates: all,
      },
    };
  }

  return { ok: false, error: { code: 'not_found', message: `no block matching "${key}".` } };
}
