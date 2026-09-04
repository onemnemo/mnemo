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
 */

import type { EditorView } from 'prosemirror-view';
import type { BlockRegistry } from '../editor/registry/build';
import { projectDocument } from '../editor/projection/document';
import { dispatchProofing, type PlacedIssue } from './proofing-plugin';
import { checkableSegments, resolveRange, type CheckableSegment } from './segments';
import { isDictionaryLoading, type ProofingClient } from './client';
import { MAX_CHARACTERS_PER_REQUEST, MAX_PARAGRAPHS_PER_REQUEST, type ProofingCheckResponse } from './types';

/** Segments per request. Well inside the wire's limit, and one frame's worth of work. */
const DEFAULT_BATCH_SIZE = 50;
/** How long the document has to stay still before an edit is checked. */
const DEFAULT_DEBOUNCE_MS = 400;
/** How long a dictionary reporting itself busy gets before the one retry. */
const DEFAULT_RETRY_MS = 2000;
/** The idle deadline, and the flat delay where idle callbacks do not exist. */
const IDLE_TIMEOUT_MS = 500;

/**
 * How many answered keys are remembered before the lot is dropped.
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
  readonly language: string;
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
  /** Cancels everything outstanding. The scheduler is dead afterwards. */
  destroy(): void;
}

export function createProofingScheduler(options: ProofingSchedulerOptions): ProofingScheduler {
  const { view, registry, noteId, language, client } = options;
  const schedule = options.schedule ?? idleSchedule;
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_PARAGRAPHS_PER_REQUEST);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;

  /** `(noteId, sid, textHash)`, the only identity an answer is filed under. */
  const answered = new Set<string>();

  let destroyed = false;
  let cancelTick: (() => void) | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  /** One retry per busy dictionary, then the next edit is what wakes it again. */
  let retriedWhileLoading = false;

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
  function nextBatch(): CheckableSegment[] {
    const batch: CheckableSegment[] = [];
    let characters = 0;
    for (const segment of checkableSegments(view.state.doc, registry)) {
      if (answered.has(keyOf(segment))) continue;
      if (batch.length > 0 && characters + segment.text.length > MAX_CHARACTERS_PER_REQUEST) break;
      batch.push(segment);
      characters += segment.text.length;
      if (batch.length >= batchSize) break;
    }
    return batch;
  }

  function pump(): void {
    if (destroyed || inFlight) return;
    const batch = nextBatch();
    if (batch.length === 0) return;

    const controller = new AbortController();
    inFlight = controller;
    void client
      .check(
        {
          language,
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
        // Anything else leaves the batch unchecked and waits for the next edit:
        // retrying a failing endpoint on a timer would turn one broken answer
        // into a stream of them.
        if (!isDictionaryLoading(error) || retriedWhileLoading) return;
        retriedWhileLoading = true;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          pump();
        }, retryMs);
      });
  }

  function applyAnswers(batch: readonly CheckableSegment[], response: ProofingCheckResponse): void {
    // A language change tears this scheduler down and builds another, so an
    // answer in a different language describes a document state nothing here
    // asked about.
    if (response.language !== language) return;

    const doc = view.state.doc;
    const projection = projectDocument(doc, registry);
    const live = new Map(checkableSegments(doc, registry).map((segment) => [segment.id, segment]));
    const byId = new Map(response.paragraphs.map((paragraph) => [paragraph.id, paragraph]));

    const segmentIds: string[] = [];
    const placed: PlacedIssue[] = [];

    // Walked over what was asked, not over what came back. A segment the
    // response leaves out has been checked and found clean as far as this is
    // concerned; filing it as unanswered would put it back at the head of the
    // queue and ask about it again on every tick, forever.
    for (const request of batch) {
      const current = live.get(request.id);
      if (!current || current.hash !== request.hash) continue;

      if (answered.size >= MAX_REMEMBERED_KEYS) answered.clear();
      answered.add(keyOf(request));
      segmentIds.push(request.id);

      for (const issue of byId.get(request.id)?.issues ?? []) {
        const range = resolveRange(doc, projection, current, issue.start, issue.end, issue.text);
        if (!range) continue;
        placed.push({
          segmentId: request.id,
          from: range.from,
          to: range.to,
          text: issue.text,
          kind: issue.kind,
          tone: issue.tone,
          ruleId: issue.ruleId,
          titleKey: issue.titleKey,
          messageKey: issue.messageKey,
          fixes: issue.fixes,
          segmentText: current.text,
          segmentStart: issue.start,
          segmentEnd: issue.end,
        });
      }
    }

    if (segmentIds.length === 0) return;
    dispatchProofing(view, { type: 'answers', segmentIds, issues: placed });
  }

  return {
    start(): void {
      if (destroyed) return;
      scheduleTick();
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
