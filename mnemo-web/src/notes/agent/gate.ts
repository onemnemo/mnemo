/**
 * The prepare/commit safety gate.
 *
 * An agent's edit is shown to the user before it lands. That opens a window
 * between "here is what I am about to do" and "do it", and the gate exists to
 * make sure nothing meaningful moved inside that window. Approving a preview
 * and getting a different edit is the failure this prevents — and it is a
 * silent one, because the document afterwards looks like something someone
 * agreed to.
 *
 * ## Preparation is side-effect-free
 *
 * `prepareEdit` compiles the batch and throws the transaction away. It does not
 * keep it, deliberately: a transaction is built against one specific document,
 * and holding one across an approval means either applying steps to a document
 * they no longer describe, or discovering that at dispatch time when there is
 * nothing useful left to say. Re-resolving at commit is cheap — the compiler is
 * pure — and it is the only way to know the ops still mean what they meant.
 *
 * ## Two independent checks at commit
 *
 * **The base version** proves the persisted ancestry is unchanged: nothing has
 * committed underneath this document since preparation. **The digest** proves
 * the batch still resolves to the same edit. Neither subsumes the other. A
 * local edit moves no version at all, and a remote commit can leave the batch
 * resolving identically.
 *
 * The local revision is deliberately *not* a third gate. It moves on every
 * keystroke, including in blocks the batch never touches, and refusing there
 * would reject edits that are still exactly what was approved. What matters is
 * whether the approved *effect* changed, and that is what the digest measures.
 *
 * ## What the digest covers
 *
 * The diff, because the diff is what the user was shown. Not the resulting
 * document: it contains freshly minted ids, so it differs on every compile even
 * when the edit is identical. That is not a detail of the hashing — it is why
 * the claim "compiling twice gives the same answer" holds semantically but not
 * byte-for-byte. `add` entries are canonicalized by their position in the batch
 * rather than by the sid they happened to draw.
 */

import type { CompileDeps, CompileError } from './ops';
import { compileOps } from './ops';
import type { AuthorityAccess, DispatchResult } from '../authority/authority';
import type { DiffEntry, NoteOp } from './types';

/**
 * An approved edit, bound to the document it was approved against.
 *
 * Carries the ops rather than a transaction. See the module comment — this is
 * the point of the whole design, not an implementation shortcut.
 */
export interface PreparedEdit {
  readonly noteId: string;
  /** The persisted version this was prepared against. */
  readonly baseVer: number;
  readonly ops: readonly NoteOp[];
  /** What the user was shown. */
  readonly diff: readonly DiffEntry[];
  readonly digest: string;
}

export type PrepareResult =
  | { readonly ok: true; readonly prepared: PreparedEdit }
  | { readonly ok: false; readonly error: CompileError };

/**
 * Why a commit refused.
 *
 * A refusal is never a partial application: the document is untouched in every
 * case. The distinctions exist because the recoveries differ — a stale version
 * wants a reload, a changed document wants a fresh preview, and a batch that no
 * longer compiles wants the agent to look again.
 */
export type CommitRefusal =
  | { readonly reason: 'wrong_note'; readonly expected: string; readonly actual: string }
  | { readonly reason: 'stale_version'; readonly expected: number; readonly actual: number }
  | { readonly reason: 'document_changed'; readonly expected: string; readonly actual: string }
  | { readonly reason: 'no_longer_applies'; readonly error: CompileError };

export type CommitResult =
  | { readonly ok: true; readonly rev: number; readonly diff: readonly DiffEntry[] }
  | { readonly ok: false; readonly refusal: CommitRefusal };

/**
 * Canonicalizes a diff into a string compared by equality.
 *
 * A string rather than a hash. Hashing would only pay for itself if this
 * travelled somewhere size-constrained, and until it does, equality on the
 * canonical form is strictly stronger — there is no collision to reason about.
 * Built through `JSON.stringify` over arrays so that text containing separators
 * or newlines cannot forge a boundary, and so key order can never enter into it.
 */
export function digestOf(diff: readonly DiffEntry[]): string {
  return JSON.stringify(
    diff.map((entry, index) => [
      entry.kind,
      // An added block's sid is minted at compile time and differs every run,
      // so adds are identified by where they sit in the batch instead.
      entry.kind === 'add' ? `#${String(index)}` : entry.sid,
      entry.type,
      entry.before ?? null,
      entry.after ?? null,
    ]),
  );
}

/**
 * Compiles a batch and reports what it would do. Changes nothing.
 *
 * Takes an `AuthorityAccess` rather than a bare state so the snapshot behind
 * the preview is the same atomic read everything else uses — a preview built
 * from a document read at one moment and a version read at another is bound to
 * a base that never existed.
 */
export function prepareEdit(
  access: AuthorityAccess,
  ops: readonly NoteOp[],
  deps: CompileDeps,
): PrepareResult {
  const snapshot = access.snapshot();
  const result = compileOps(access.state, ops, deps);
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    prepared: {
      noteId: snapshot.noteId,
      baseVer: snapshot.ver,
      ops,
      diff: result.diff,
      digest: digestOf(result.diff),
    },
  };
}

/**
 * Re-resolves an approved edit and applies it only if it is still that edit.
 *
 * Takes `AuthorityAccess`, which is only reachable inside a queued command, so
 * the check and the apply cannot be separated by another writer. A version read
 * in one command and acted on in the next is exactly the race this gate is for.
 */
export function commitEdit(
  access: AuthorityAccess,
  prepared: PreparedEdit,
  deps: CompileDeps,
): CommitResult {
  const snapshot = access.snapshot();

  if (snapshot.noteId !== prepared.noteId) {
    // Cheap to check and catastrophic to miss: an approval carries no visible
    // sign of which note it came from, and sids are unique only within one.
    return {
      ok: false,
      refusal: { reason: 'wrong_note', expected: prepared.noteId, actual: snapshot.noteId },
    };
  }

  if (snapshot.ver !== prepared.baseVer) {
    return {
      ok: false,
      refusal: { reason: 'stale_version', expected: prepared.baseVer, actual: snapshot.ver },
    };
  }

  const result = compileOps(access.state, prepared.ops, deps);
  if (!result.ok) {
    // The batch compiled at preparation and does not now, so the document moved
    // under it — a targeted block was deleted, or a `find` no longer matches.
    return { ok: false, refusal: { reason: 'no_longer_applies', error: result.error } };
  }

  const digest = digestOf(result.diff);
  if (digest !== prepared.digest) {
    return {
      ok: false,
      refusal: { reason: 'document_changed', expected: prepared.digest, actual: digest },
    };
  }

  const dispatched: DispatchResult = access.apply(result.tr);
  return { ok: true, rev: dispatched.rev, diff: result.diff };
}
