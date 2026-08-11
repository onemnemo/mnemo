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
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { onAppEvent } from "@/events/subscribers"
import { EventType, type AppEvent, type MindmapChangedEventData } from "@/events/types"

import {
  applyMindmapOps,
  arrangeMindmap,
  foldEditIntoCache,
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
}

export function useMindmapEditor(mapId: string | null): MindmapEditor {
  const client = useQueryClient()
  const [history, setHistoryState] = useState<HistoryState>(emptyHistory)
  const [rejected, setRejected] = useState<MindmapEditError | null>(null)

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
  }, [mapId])

  const revisionOf = useCallback(
    (id: string): number => client.getQueryData<MindmapDocument>(mapKey(id))?.revision ?? 0,
    [client],
  )

  /**
   * The map moved under us. Refetching is the only honest answer: the deltas we hold describe a
   * document we no longer have, and folding one of those produces a map that renders fine and is
   * quietly wrong.
   */
  const reload = useCallback(
    (id: string) => {
      void client.invalidateQueries({ queryKey: mapKey(id) })
    },
    [client],
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
            if (outcome.status === "conflict") {
              reload(mapId)
            } else {
              setRejected(outcome.error)
            }
            return null
          }

          const { result } = outcome
          liveRef.current = endWrite(liveRef.current, result.revision)
          setRejected(null)

          // A write that did not move the revision changed nothing, so there is nothing to fold and
          // nothing worth an undo step. An arrange of a map already in that shape lands here.
          if (result.revision === before) {
            return result
          }

          // The server withholds the delta when another session's commit interleaved, and a fold is
          // exactly what must not happen then.
          if (!foldEditIntoCache(client, mapId, result)) {
            reload(mapId)
            return result
          }

          if (result.undo && result.redo) {
            setHistory(
              record(historyRef.current, {
                undo: result.undo,
                redo: result.redo,
                label: step.label,
                coalesceKey: step.coalesceKey ?? null,
              }),
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
   * Replays a delta. The entry stays on the stack unless the replay lands, because a restore refused
   * for a stale revision is a step the user still has not taken, not a step they have.
   */
  const travel = useCallback(
    (direction: "undo" | "redo") =>
      void enqueue(async () => {
        if (!mapId) {
          return
        }
        const step = direction === "undo" ? popUndo(historyRef.current) : popRedo(historyRef.current)
        if (!step) {
          return
        }

        const delta = direction === "undo" ? step.entry.undo : step.entry.redo
        liveRef.current = beginWrite(liveRef.current)
        const outcome = await restoreMindmap(mapId, revisionOf(mapId), delta)

        if (outcome.status !== "applied") {
          liveRef.current = endWrite(liveRef.current, outcome.error.revision)
          reload(mapId)
          return
        }

        liveRef.current = endWrite(liveRef.current, outcome.result.revision)
        if (!foldRestoreIntoCache(client, mapId, delta, outcome.result)) {
          reload(mapId)
        }
        setHistory(step.next)
      }),
    [client, enqueue, mapId, reload, revisionOf, setHistory],
  )

  // A change notice is a nudge rather than a patch, and most of them are this editor's own echo.
  useEffect(() => {
    if (!mapId) {
      return
    }
    return onAppEvent(EventType.MindmapChanged, (event: AppEvent) => {
      const notice = event.data as MindmapChangedEventData
      const action = classify(liveRef.current, notice, mapId)
      if (action === "reload") {
        liveRef.current = adoptRevision(liveRef.current, notice.revision)
        reload(mapId)
      }
    })
  }, [mapId, reload])

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
  }
}
