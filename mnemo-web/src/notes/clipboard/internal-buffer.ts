/**
 * The exact same-app clipboard path: the last copied slice, held in memory and
 * keyed by a nonce.
 *
 * The OS clipboard can only carry serialized formats, and even the high-fidelity
 * HTML carrier survives a round trip through a browser engine imperfectly. So a
 * copy also stashes the live ProseMirror slice here and writes the nonce onto
 * the clipboard; a paste that finds a matching nonce restores this exact slice
 * instead of reparsing HTML, which is lossless for every block, mark, atom and
 * column shape. It is the port's equivalent of the desktop's in-process
 * clipboard fast path.
 *
 * One entry is enough: only the most recent copy can be pasted, and a stale
 * entry is never read because the nonce on the clipboard will not match it. The
 * slice is only ever a same-session object; a copy from another window or a
 * previous run has no entry here and falls through to the HTML carrier.
 */

import type { Slice } from 'prosemirror-model';

export type ClipboardMode = 'blocks' | 'text';

interface BufferEntry {
  readonly nonce: string;
  readonly slice: Slice;
  readonly mode: ClipboardMode;
}

let current: BufferEntry | null = null;

/** Stash a copied slice and return the nonce to stamp onto the clipboard. */
export function stashSlice(slice: Slice, mode: ClipboardMode): string {
  const nonce = newNonce();
  current = { nonce, slice, mode };
  return nonce;
}

/** The stashed slice for a nonce, or null when the clipboard came from elsewhere. */
export function readStashedSlice(nonce: string): { slice: Slice; mode: ClipboardMode } | null {
  if (!current || current.nonce !== nonce) return null;
  return { slice: current.slice, mode: current.mode };
}

/** Test seam: forget the stashed slice. */
export function clearStashedSlice(): void {
  current = null;
}

function newNonce(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `mnemo-${c.randomUUID()}`;
  // Older engines without crypto.randomUUID: uniqueness only has to hold within
  // a session, so time plus a random tail is ample and never read cross-run.
  return `mnemo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
