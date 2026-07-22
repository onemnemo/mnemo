/**
 * Turns a document snapshot into a content commit.
 *
 * This is the only place a note's body leaves the editor. It is deliberately a
 * plain function of its dependencies rather than a hook: the authority calls it
 * from outside React, and the interesting parts, which outcome means what, and
 * what a request id has to be, are worth testing without a component tree
 * around them.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { CommitNoteContentDto, NoteCommitResultDto } from '@/api/types';
import type { CommitOutcome, NoteSnapshot, Persist } from '../authority/authority';
import type { Block } from '../model/types';
import { serializeBlocks } from '../model/wire';

/** Sends one commit. Rejects for anything that is not a protocol outcome. */
export type CommitTransport = (
  noteId: string,
  body: CommitNoteContentDto,
) => Promise<NoteCommitResultDto>;

export interface PersistDeps {
  /** The document mapper's reverse direction. */
  fromDoc(doc: PMNode): Block[];
  readonly commit: CommitTransport;
  /**
   * Distinguishes this editing session's request ids from every other's.
   *
   * Defaults to a fresh random value, which is the only correct default, see
   * {@link requestIdOf} for what a shared one would do.
   */
  readonly sessionId?: string;
}

/**
 * The id under which a commit is idempotent.
 *
 * A revision is exactly the right key for the *edit*: `rev` moves only when the
 * document changes, so two commits at one revision carry byte-identical blocks
 * and replaying the id is precisely the "this already landed" the server reads
 * it as. What a revision is not is unique, it restarts at 0 every time a note
 * is opened. Keyed on the revision alone, the first edit of a second session
 * would reuse the first session's id, and the server would answer
 * `AlreadyApplied` to a write it has never seen and drop it. The session nonce
 * is what makes the id identify an edit rather than a position in a counter.
 */
export function requestIdOf(sessionId: string, rev: number): string {
  return `${sessionId}:${String(rev)}`;
}

/**
 * Maps the server's outcome onto the authority's.
 *
 * `AlreadyApplied` is an applied commit, not a special case: it means a retry
 * whose original response was lost did land. Reporting it as anything else
 * turns a dropped acknowledgement into a conflict a person has to resolve by
 * hand. `NotFound` is failure rather than conflict, there is no version to
 * rebase onto, because there is no note.
 */
export function toCommitOutcome(result: NoteCommitResultDto): CommitOutcome {
  switch (result.outcome) {
    case 'Applied':
    case 'AlreadyApplied':
      return { status: 'applied', ver: result.ver };
    case 'Stale':
      return { status: 'conflict', ver: result.ver };
    case 'NotFound':
      return { status: 'failed', error: new Error('the note no longer exists') };
  }
}

export function createPersist(deps: PersistDeps): Persist {
  const sessionId = deps.sessionId ?? crypto.randomUUID();

  return async (snapshot: NoteSnapshot): Promise<CommitOutcome> => {
    const blocks = serializeBlocks(deps.fromDoc(snapshot.doc));
    const result = await deps.commit(snapshot.noteId, {
      // The version the document in hand is based on, not the current stored
      // one. The whole conflict check is that they are the same number.
      baseVer: snapshot.ver,
      requestId: requestIdOf(sessionId, snapshot.rev),
      blocks,
    });
    return toCommitOutcome(result);
  };
}
