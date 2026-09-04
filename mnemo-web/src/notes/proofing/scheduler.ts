/**
 * Who asks, when, and about what.
 *
 * The plugin holds marks and the client holds the wire; this decides the pace,
 * and the pace is the whole problem. A note can be four thousand blocks, it can
 * arrive a thousand blocks at a time, and the user is typing into it the whole
 * while.
 *
 * Four rules follow from that:
 *
 *  - It reads `view.state`, never the editor handle or the session. Reading the
 *    handle drains a chunked mount synchronously, which is the freeze chunking
 *    exists to avoid.
 *  - One request is in flight at a time and the next batch waits for an idle
 *    callback, so a transaction carrying a thousand new blocks costs one
 *    request on that frame rather than twenty.
 *  - A segment is asked about once per text. The key is the note, the block's
 *    short id and a hash of the sent text, because a split re-mints one half's
 *    sid and an undo can bring an old one back, so the sid alone is not an
 *    identity.
 *  - An answer is applied only where the segment still hashes to what was
 *    asked. Anything else is an answer about text the user has since replaced.
 *
 * The answer to a text is *kept*, not just the fact that one was given. Marks
 * are transient: a fix takes a mark's content out, a re-check replaces a
 * segment's marks wholesale, and neither can be reversed by mapping alone. So an
 * undo, a redo or retyping the same words lands the document back on a text this
 * has already answered but whose marks are gone, and remembering only "asked"
 * would leave that text silently unchecked, the mistake unflagged, or a stale
 * underline sitting over a word that is now correct. Remembering the answer lets
 * the marks be put back from memory the instant the text returns, with no second
 * trip to the network.
 */

import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { BlockRegistry } from '../editor/registry/build';
import { dispatchProofing, getProofingState, type LocatedIssue } from './proofing-plugin';
import { checkableSegments, resolveRange, type CheckableSegment } from './segments';
import { isDictionaryLoading, type ProofingClient } from './client';
import {
  MAX_CHARACTERS_PER_REQUEST,
  MAX_PARAGRAPHS_PER_REQUEST,
  type ProofingCheckResponse,
  type ProofingIssue as WireIssue,
} from './types';

/** Segments per request. Well inside the wire's limit, and one frame's worth of work. */
const DEFAULT_BATCH_SIZE = 50;
/** How long the document has to stay still before an edit is checked. */
const DEFAULT_DEBOUNCE_MS = 400;
/** How long a dictionary reporting itself busy gets before the one retry. */
const DEFAULT_RETRY_MS = 2000;
/** The idle deadline, and the flat delay where idle callbacks do not exist. */
const IDLE_TIMEOUT_MS = 500;

/**
 * The most marks one segment may contribute.
 *
 * A paragraph with more flagged words than this is not a paragraph with
 * mistakes in it, it is a paragraph the dictionary cannot read: a formula, a
 * table of identifiers, or prose in a language nothing installed covers. The
 * surplus is dropped rather than drawn, because underlining every word of it
 * tells the reader nothing they cannot already see.
 */
const MAX_ISSUES_PER_SEGMENT = 25;

/**
 * How many answered texts are remembered before the lot is dropped.
 *
 * Every edit to a segment mints a new key and the old one stays, so a long
 * session in one note would otherwise grow without bound. Dropping the lot
 * costs one full re-check, which is correct, just wasteful, and at this size
 * it is hours of typing away.
 */
const MAX_REMEMBERED_KEYS = 20_000;

/** Schedules deferred work and hands back the way to cancel it. */
export type ProofingSchedule = (run: () => void) => () => void;

interface IdleGlobals {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

export function idleSchedule(run: () => void): () => void {
  const host = globalThis as IdleGlobals;
  if (typeof host.requestIdleCallback === 'function') {
    const handle = host.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => host.cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(run, IDLE_TIMEOUT_MS);
  return () => {
    clearTimeout(timer);
  };
}

export interface ProofingSchedulerOptions {
  readonly view: EditorView;
  readonly registry: BlockRegistry;
  readonly noteId: string;
  /** Ordered, and every one of them ready. A word is correct when any of them knows it. */
  readonly languages: readonly string[];
  readonly client: ProofingClient;
  readonly schedule?: ProofingSchedule;
  readonly batchSize?: number;
  readonly debounceMs?: number;
  readonly retryMs?: number;
}

export interface ProofingScheduler {
  /** Begins the pass over the whole note. Safe to call more than once. */
  start(): void;
  /** The document changed; re-check what changed once it settles. */
  noteEdit(): void;
  /**
   * A word list changed, so every segment naming one of these words has to be
   * asked about again. Words arrive composed and lowercased, which is how the
   * segment text is folded before the comparison.
   */
  forgetWords(words: readonly string[]): void;
  /** Cancels everything outstanding. The scheduler is dead afterwards. */
  destroy(): void;
}

export function createProofingScheduler(options: ProofingSchedulerOptions): ProofingScheduler {
  const { view, registry, noteId, languages, client } = options;
  /** The set this scheduler exists for, in the form the answer echoes back. */
  const identity = languages.join(',');
  const schedule = options.schedule ?? idleSchedule;
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_PARAGRAPHS_PER_REQUEST);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;

  /**
   * The answer on file for each `(noteId, sid, textHash)`: the issues the check
   * returned for that exact text, segment-local, ready to be placed again. An
   * empty array is a real answer too, the text was checked and found clean.
   */
  const answers = new Map<string, readonly WireIssue[]>();
  /**
   * The key of the answer whose marks are currently drawn for each segment, so a
   * pass can tell a segment already showing the right marks from one whose text
   * has moved back to something answered while its marks were taken away. Absent
   * means nothing of this segment's is drawn.
   */
  const drawnKey = new Map<string, string>();
  /** Segments whose batch has failed once. A second failure retires them. */
  const failedOnce = new Set<string>();

  let destroyed = false;
  let cancelTick: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  /** One retry per busy dictionary, then the next edit is what wakes it again. */
  let retriedWhileLoading = false;
  /** The segment ids the document held last time it was looked at. */
  let seenSegmentIds = new Set<string>();

  function keyOf(segment: CheckableSegment): string {
    return `${noteId}|${segment.sid}:${String(segment.segmentIndex)}|${segment.hash}`;
  }

  function clearTick(): void {
    cancelTick?.();
    cancelTick = null;
  }

  function scheduleTick(): void {
    if (destroyed || cancelTick) return;
    cancelTick = schedule(() => {
      cancelTick = null;
      pump();
    });
  }

  /** The next batch of segments with no answer on file, in document order. */
  function nextBatch(segments: readonly CheckableSegment[]): CheckableSegment[] {
    const batch: CheckableSegment[] = [];
    let characters = 0;
    for (const segment of segments) {
      if (answers.has(keyOf(segment))) continue;
      if (batch.length > 0 && characters + segment.text.length > MAX_CHARACTERS_PER_REQUEST) break;
      batch.push(segment);
      characters += segment.text.length;
      if (batch.length >= batchSize) break;
    }
    return batch;
  }

  /** A remembered answer, located against the segment as it stands now. */
  function locate(doc: PMNode, segment: CheckableSegment, issues: readonly WireIssue[]): LocatedIssue[] {
    const out: LocatedIssue[] = [];
    for (const issue of issues.slice(0, MAX_ISSUES_PER_SEGMENT)) {
      const range = resolveRange(doc, segment, issue.start, issue.end, issue.text);
      if (!range) continue;
      out.push({
        from: range.from,
        to: range.to,
        issue: {
          segmentId: segment.id,
          text: issue.text,
          kind: issue.kind,
          tone: issue.tone,
          ruleId: issue.ruleId,
          titleKey: issue.titleKey,
          messageKey: issue.messageKey,
          fixes: issue.fixes,
          segmentText: segment.text,
          segmentStart: issue.start,
          segmentEnd: issue.end,
        },
      });
    }
    return out;
  }

  /**
   * Takes back the marks of segments the document no longer has.
   *
   * Only an answer names a segment, and an answer only ever names one that is
   * still checkable, so a segment that leaves the set (a block merged away by
   * a range delete, a line turned entirely into inline code, a paragraph
   * converted to a block equation) would otherwise leave its underline behind
   * over text nothing reported. Dispatched only when the set actually shrank,
   * so an ordinary pass costs one `Set.has` per segment and no transaction.
   *
   * A segment that leaves also forgets which marks it had drawn, so if it comes
   * back (an undo of the delete) at a text still on file, the pass below draws
   * it again rather than reading its old record and deciding nothing changed.
   */
  function reconcile(segments: readonly CheckableSegment[]): void {
    const live = new Set(segments.map((segment) => segment.id));
    let shrank = false;
    for (const id of seenSegmentIds) {
      if (!live.has(id)) {
        shrank = true;
        drawnKey.delete(id);
      }
    }
    seenSegmentIds = live;
    if (shrank) dispatchProofing(view, { type: 'prune', liveSegmentIds: [...live] });
  }

  /**
   * Puts the remembered marks back wherever a segment's live text has an answer
   * on file that its drawn marks do not match.
   *
   * This is what makes an undo, a redo or retyping honest. Mapping carries a
   * mark that survives an edit, but it cannot resurrect one whose content was
   * replaced or whose segment a later answer cleared, and a text the user
   * returns to is exactly such a case. Walking every live segment and comparing
   * the answer its text now has against the answer its marks were drawn from is
   * O(document) and no network, and it fires a single transaction for everything
   * that moved, so the common pass (nothing moved back) is a comparison per
   * segment and no dispatch at all.
   */
  function redraw(segments: readonly CheckableSegment[]): void {
    const doc = view.state.doc;
    const segmentIds: string[] = [];
    const placed: LocatedIssue[] = [];
    let moved = false;

    for (const segment of segments) {
      const key = keyOf(segment);
      const answer = answers.get(key);
      if (answer === undefined) continue;
      if (drawnKey.get(segment.id) === key) continue;
      moved = true;
      segmentIds.push(segment.id);
      placed.push(...locate(doc, segment, answer));
      drawnKey.set(segment.id, key);
    }

    if (!moved) return;
    dispatchProofing(view, {
      type: 'answers',
      segmentIds,
      issues: placed,
      liveSegmentIds: segments.map((segment) => segment.id),
    });
  }

  /**
   * Whether a segment is worth asking about again after a word list changed.
   *
   * A substring rather than a word match, deliberately. Getting the boundary
   * right needs the tokenizer's rules, which live on the host, and the cost of
   * being loose is one re-check of a paragraph that was going to come back the
   * same. The cost of being tight is an underline that never goes away.
   */
  function mentionsAny(text: string, words: readonly string[]): boolean {
    const haystack = text.normalize('NFC').toLowerCase();
    return words.some((word) => haystack.includes(word));
  }

  function pump(): void {
    if (destroyed) return;
    const segments = checkableSegments(view.state.doc, registry);
    // Before the cap check, because taking orphans back is what can bring a
    // paused note under it again.
    reconcile(segments);
    // Local, so it runs even while a request is in flight: an undo must not have
    // to wait for the network to get its underline back.
    redraw(segments);

    // The network half is the only part that waits on the one request in flight.
    if (inFlight) return;

    // Past the note's cap nothing more can be drawn, so asking would spend the
    // network on answers with nowhere to go. The batch that overflowed is still
    // on file as answered, so a note that comes back under the cap carries on
    // from where it stopped rather than re-asking about the marks it dropped.
    if (getProofingState(view.state).paused) return;
    const batch = nextBatch(segments);
    if (batch.length === 0) return;

    const controller = new AbortController();
    inFlight = controller;
    void client
      .check(
        {
          languages,
          noteId,
          paragraphs: batch.map((segment) => ({ id: segment.id, text: segment.text })),
        },
        controller.signal,
      )
      .then((response) => {
        inFlight = null;
        if (destroyed) return;
        retriedWhileLoading = false;
        applyAnswers(batch, response);
        scheduleTick();
      })
      .catch((error: unknown) => {
        inFlight = null;
        if (destroyed) return;

        // A dictionary that is still loading will answer the same way for every
        // later batch too, so this waits rather than working through the note
        // collecting the same refusal.
        if (isDictionaryLoading(error)) {
          if (retriedWhileLoading) return;
          retriedWhileLoading = true;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            pump();
          }, retryMs);
          return;
        }

        // Anything else is about this batch, not about the note. One retry, and
        // then it is retired so the rest of the pass still happens: left in
        // place, a single rejected batch keeps every segment after it unchecked
        // until the user happens to type, which on a long note is most of it. A
        // retired batch is filed as answered-clean so nothing re-asks about it.
        const keys = batch.map(keyOf);
        if (keys.every((key) => failedOnce.has(key))) {
          for (const key of keys) answers.set(key, []);
        } else {
          for (const key of keys) failedOnce.add(key);
        }
        scheduleTick();
      });
  }

  function applyAnswers(batch: readonly CheckableSegment[], response: ProofingCheckResponse): void {
    // A language change tears this scheduler down and builds another, so an
    // answer over a different set describes a document state nothing here asked
    // about. The batch is filed as answered-clean rather than left open,
    // because a mismatch means the status this was built from is already stale
    // and its refetch will replace this scheduler outright: re-queuing the
    // batch here would spend the whole interval asking the same question.
    if (response.languages.join(',') !== identity) {
      for (const key of batch.map(keyOf)) answers.set(key, []);
      return;
    }

    const doc = view.state.doc;
    const live = new Map(checkableSegments(doc, registry).map((segment) => [segment.id, segment]));
    const byId = new Map(response.paragraphs.map((paragraph) => [paragraph.id, paragraph]));

    const segmentIds: string[] = [];
    const placed: LocatedIssue[] = [];

    // Walked over what was asked, not over what came back. A segment the
    // response leaves out has been checked and found clean as far as this is
    // concerned; filing it as unanswered would put it back at the head of the
    // queue and ask about it again on every tick, forever.
    for (const request of batch) {
      const current = live.get(request.id);
      if (!current || current.hash !== request.hash) continue;

      if (answers.size >= MAX_REMEMBERED_KEYS) {
        answers.clear();
        drawnKey.clear();
      }
      const key = keyOf(request);
      const issues = byId.get(request.id)?.issues ?? [];
      answers.set(key, issues);
      drawnKey.set(request.id, key);
      segmentIds.push(request.id);
      placed.push(...locate(doc, current, issues));
    }

    if (segmentIds.length === 0) return;
    dispatchProofing(view, {
      type: 'answers',
      segmentIds,
      issues: placed,
      liveSegmentIds: [...live.keys()],
    });
  }

  return {
    start(): void {
      if (destroyed) return;
      scheduleTick();
    },

    forgetWords(words: readonly string[]): void {
      if (destroyed || words.length === 0) return;

      let touched = false;
      for (const segment of checkableSegments(view.state.doc, registry)) {
        if (!mentionsAny(segment.text, words)) continue;
        // The drawn record goes with it, so the answer that replaces this one is
        // put on screen rather than compared against marks it no longer matches.
        const key = keyOf(segment);
        failedOnce.delete(key);
        drawnKey.delete(segment.id);
        if (answers.delete(key)) touched = true;
      }

      if (touched) scheduleTick();
    },

    noteEdit(): void {
      if (destroyed) return;
      retriedWhileLoading = false;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        pump();
      }, debounceMs);
    },

    destroy(): void {
      destroyed = true;
      clearTick();
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      debounceTimer = null;
      retryTimer = null;
      inFlight?.abort();
      inFlight = null;
    },
  };
}
