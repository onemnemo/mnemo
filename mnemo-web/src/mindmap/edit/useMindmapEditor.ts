/**
 * The one way an edit reaches the server, and the one place undo knows about.
 *
 * Every gesture on the canvas, every control in a selection bar and every AI tool call funnels
 * through `apply`. That is not tidiness for its own sake: the server computes the undo delta for a
 * batch, so a write that goes around this function is a write that cannot be undone, and there is no
 * later opportunity to reconstruct one.
 *
 * Writes are serialized. A batch carries the revision it expects, so two overlapping writes would
 * both name the revision before either landed and the second would come back a conflict every time,
 * which on a canvas is not a rare interleave but the ordinary case of dragging a node and letting go
 * while a rename is still in the air.
 *
 * One rule runs through all of it. A delta is a verbatim rewrite of named ids, so it is only ever
 * correct against the exact revision it was computed from, and applying one anywhere else does not
 * fail loudly, it succeeds and produces a document that renders fine and is quietly wrong. So the
 * cache is only patched when it holds the revision the write applied against, the undo stack carries
 * the revision it is replayable against and sends it with every replay, and anything that breaks
 * either of those refetches and starts a fresh stack rather than guessing.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { onAppEvent } from "@/events/subscribers"
import { EventType, type AppEvent } from "@/events/types"
import { useT } from "@/i18n/useT"

import {
  applyMindmapOps,
  arrangeMindmap,
  foldEditIntoCache,
  foldNoticeIntoCache,
  foldRestoreIntoCache,
  mapKey,
  restoreMindmap,
  type EditOutcome,
  type MindmapEditError,
  type MindmapOpsResult,
} from "../api"
import type { MindmapDocument } from "../model/document"
import {
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo as popRedo,
  redoLabel,
  settle,
  undo as popUndo,
  undoLabel,
  type HistoryState,
} from "../model/history"
import {
  adoptRevision,
  beginWrite,
  classify,
  endWrite,
  initialLiveRevision,
  type LiveRevisionState,
  type MindmapChangedNotice,
} from "../model/live-revision"
import type { MindmapOp } from "../model/ops"

/** What an edit is called in the undo control, and whether it folds into the step before it. */
export interface EditStep {
  label: string
  /** Consecutive steps sharing a key become one undo. Null, the default, never folds. */
  coalesceKey?: string | null
}

export interface MindmapEditor {
  /**
   * Applies one batch and resolves with what the server made of it. Null means the batch never
   * landed, either because it was refused or because the map moved on and was refetched instead.
   */
  apply(ops: MindmapOp[], step: EditStep): Promise<MindmapOpsResult | null>
  /**
   * Asks the server to lay the map out and commits what it computes, as one batch and one undo step.
   *
   * The sizes are the client's, because a node is as wide as its rendered text and nothing on the
   * server has seen the font. An arrange of a map already in that shape moves nothing and records
   * nothing.
   */
  arrange(
    sizes: Record<string, [number, number]>,
    step: EditStep,
    algorithm?: string,
  ): Promise<MindmapOpsResult | null>
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | undefined
  redoLabel: string | undefined
  /** The last batch the server refused, cleared by the next one it accepts. */
  rejected: MindmapEditError | null
  /**
   * Set when the map moved under this editor and the document had to be refetched, so the loss of
   * the undo stack is something the user is told about rather than something they discover by
   * pressing Ctrl+Z and watching nothing happen. Cleared by the next write that lands.
   */
  reloaded: boolean
  /** The map was deleted while it was open. There is no document to edit and none coming. */
  closed: boolean
}

/**
 * @param mapId the open map, or null when none is.
 * @param revision the revision of the document as loaded, which seeds the stack and the notice
 * filter. Without it a fresh editor believes it holds revision zero, treats the first notice for its
 * own map as somebody else's write, and refetches a document it just fetched.
 */
export function useMindmapEditor(mapId: string | null, revision?: number): MindmapEditor {
  const client = useQueryClient()
  const t = useT()
  const [history, setHistoryState] = useState<HistoryState>(emptyHistory)
  const [rejected, setRejected] = useState<MindmapEditError | null>(null)
  const [reloaded, setReloaded] = useState(false)
  const [closed, setClosed] = useState(false)

  const historyRef = useRef(history)
  const liveRef = useRef<LiveRevisionState>(initialLiveRevision(0))
  // Every write chains onto the one before it, so a batch is never composed against a revision that
  // a batch already in flight is about to move past.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  const setHistory = useCallback((next: HistoryState) => {
    historyRef.current = next
    setHistoryState(next)
  }, [])

  // A different map is a different document, a different revision line and a different undo stack.
  useEffect(() => {
    historyRef.current = emptyHistory()
    setHistoryState(historyRef.current)
    liveRef.current = initialLiveRevision(0)
    setRejected(null)
    setReloaded(false)
    setClosed(false)
  }, [mapId])

  /**
   * The document arrived, or came back from a refetch.
   *
   * An empty stack has no deltas that could be stale, so it simply adopts whatever revision the
   * document is on. A stack with entries on it keeps the revision its own writes put there: those
   * deltas describe a specific document, and quietly re-pointing them at a newer one is the exact
   * mistake this whole file exists to avoid.
   */
  useEffect(() => {
    if (revision === undefined) {
      return
    }
    liveRef.current = adoptRevision(liveRef.current, revision)
    const stack = historyRef.current
    if (stack.past.length === 0 && stack.future.length === 0 && stack.revision !== revision) {
      setHistory(emptyHistory(revision))
    }
  }, [revision, setHistory])

  const revisionOf = useCallback(
    (id: string): number => client.getQueryData<MindmapDocument>(mapKey(id))?.revision ?? 0,
    [client],
  )

  /**
   * The map moved under us. Refetching is the only honest answer: the deltas we hold describe a
   * document we no longer have, and folding one of those produces a map that renders fine and is
   * quietly wrong. The stack goes with the document for the same reason, and the flag is so the
   * loss is announced rather than discovered.
   */
  const reload = useCallback(
    (id: string) => {
      setHistory(emptyHistory())
      setReloaded(true)
      void client.invalidateQueries({ queryKey: mapKey(id) })
    },
    [client, setHistory],
  )

  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = queueRef.current.then(work, work)
    // Swallowed on the queue only. The caller still sees the rejection through its own handle; this
    // copy exists so one failed write does not poison every write after it.
    queueRef.current = next.catch(() => undefined)
    return next
  }, [])

  /**
   * The one write path.
   *
   * Everything that changes the document comes through here whatever computed the batch, because this
   * is where a write is serialized against the others, where it names the revision it expects, where
   * the answer is folded into the cache, and where the undo step is recorded. A second path would be a
   * second place for all four to be got subtly differently.
   */
  const commit = useCallback(
    (
      step: EditStep,
      send: (id: string, revision: number) => Promise<EditOutcome>,
    ): Promise<MindmapOpsResult | null> =>
      enqueue(async () => {
        if (!mapId) {
          return null
        }

        const before = revisionOf(mapId)
        liveRef.current = beginWrite(liveRef.current)
        try {
          const outcome = await send(mapId, before)

          if (outcome.status !== "applied") {
            liveRef.current = endWrite(liveRef.current, outcome.error.revision)
            // Both are told, not just the refusal. A conflict costs the user their undo stack, and a
            // reload that says nothing is indistinguishable from the editor having quietly forgotten.
            setRejected(outcome.error)
            if (outcome.status === "conflict") {
              reload(mapId)
            }
            return null
          }

          const { result } = outcome
          liveRef.current = endWrite(liveRef.current, result.revision)
          setRejected(null)
          setReloaded(false)

          // A write that did not move the revision changed nothing, so there is nothing to fold and
          // nothing worth an undo step. An arrange of a map already in that shape lands here.
          if (result.revision === before) {
            return result
          }

          // Refused when the document we hold is not the one the write applied against, which a
          // server-side rebase and another session's commit both make true.
          if (!foldEditIntoCache(client, mapId, result)) {
            reload(mapId)
            return result
          }

          if (result.undo && result.redo) {
            setHistory(
              record(
                historyRef.current,
                {
                  undo: result.undo,
                  redo: result.redo,
                  label: step.label,
                  coalesceKey: step.coalesceKey ?? null,
                },
                result.revision,
              ),
            )
          }
          return result
        } catch (error) {
          liveRef.current = endWrite(liveRef.current, revisionOf(mapId))
          throw error
        }
      }),
    [client, enqueue, mapId, reload, revisionOf, setHistory],
  )

  const apply = useCallback(
    (ops: MindmapOp[], step: EditStep): Promise<MindmapOpsResult | null> =>
      ops.length === 0
        ? Promise.resolve(null)
        : commit(step, (id, revision) => applyMindmapOps(id, revision, ops)),
    [commit],
  )

  const arrange = useCallback(
    (
      sizes: Record<string, [number, number]>,
      step: EditStep,
      algorithm?: string,
    ): Promise<MindmapOpsResult | null> =>
      commit(step, (id, revision) => arrangeMindmap(id, revision, sizes, algorithm)),
    [commit],
  )

  /**
   * Replays a delta.
   *
   * The revision it expects is the stack's own, not the document's. Those are the same number right
   * up until somebody else writes, and that is exactly the case worth getting right: the stack's
   * deltas were computed against the revision it records, so sending the document's newer one would
   * ask the server to accept a rewrite of a state it has moved past, and the server would, because
   * the request would look perfectly current. Sending the stack's revision makes it a conflict, which
   * is what it is.
   *
   * The entry stays on the stack unless the replay lands, because a restore refused for a stale
   * revision is a step the user still has not taken, not a step they have.
   */
  const travel = useCallback(
    (direction: "undo" | "redo") =>
      void enqueue(async () => {
        if (!mapId) {
          return
        }
        const stack = historyRef.current
        const step = direction === "undo" ? popUndo(stack) : popRedo(stack)
        if (!step) {
          return
        }

        const delta = direction === "undo" ? step.entry.undo : step.entry.redo
        liveRef.current = beginWrite(liveRef.current)
        const outcome = await restoreMindmap(mapId, stack.revision, delta)

        if (outcome.status !== "applied") {
          liveRef.current = endWrite(liveRef.current, outcome.error.revision)
          setRejected(outcome.error)
          reload(mapId)
          return
        }

        liveRef.current = endWrite(liveRef.current, outcome.result.revision)
        if (!foldRestoreIntoCache(client, mapId, delta, outcome.result)) {
          reload(mapId)
          return
        }
        setRejected(null)
        setReloaded(false)
        setHistory(settle(step.next, outcome.result.revision))
      }),
    [client, enqueue, mapId, reload, setHistory],
  )

  /**
   * Somebody else wrote to the map we have open.
   *
   * Most notices are this editor's own echo and are ignored. A real one is absorbed whole when the
   * server sent the write with it and we are on the revision it landed on: the document is patched
   * and one entry goes on the stack, so an assistant that rewrites half a map is one Ctrl+Z to take
   * back. Anything else refetches, which costs the stack and says so.
   */
  useEffect(() => {
    if (!mapId) {
      return
    }
    return onAppEvent(EventType.MindmapChanged, (event: AppEvent) => {
      const notice = event.data as MindmapChangedNotice
      const action = classify(liveRef.current, notice, mapId)
      if (action === "ignore") {
        return
      }
      if (action === "closed") {
        setClosed(true)
        return
      }
      if (
        action === "fold" &&
        notice.undo &&
        notice.redo &&
        notice.order &&
        notice.baseRevision !== undefined &&
        foldNoticeIntoCache(client, mapId, notice.redo, notice.baseRevision, notice.revision, notice.order)
      ) {
        liveRef.current = adoptRevision(liveRef.current, notice.revision)
        setHistory(
          record(
            historyRef.current,
            {
              undo: notice.undo,
              redo: notice.redo,
              // Named for what it was rather than for who did it, because the channel does not say
              // and "Undo assistant edit" would be a guess printed on a button.
              label: t("Mindmap", notice.kind === "renamed" ? "Rename" : "ExternalChange"),
              coalesceKey: null,
            },
            notice.revision,
          ),
        )
        return
      }
      liveRef.current = adoptRevision(liveRef.current, notice.revision)
      reload(mapId)
    })
  }, [client, mapId, reload, setHistory, t])

  return {
    apply,
    arrange,
    undo: useCallback(() => travel("undo"), [travel]),
    redo: useCallback(() => travel("redo"), [travel]),
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undoLabel: undoLabel(history),
    redoLabel: redoLabel(history),
    rejected,
    reloaded,
    closed,
  }
}
