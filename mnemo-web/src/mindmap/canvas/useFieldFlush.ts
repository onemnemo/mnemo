/**
 * The way an open field on the canvas closes.
 *
 * A node label, a frame title and an edge label all end the same four ways: Enter, Escape, a blur,
 * or the field simply going away. The first three are events the field can answer. The fourth is
 * not, and a component being taken apart has one moment to hand over what was typed.
 */

import { useCallback, useEffect, useRef } from "react"

import { onShutdown } from "@/app/shutdown"

export interface FieldFlush {
  /**
   * Closes the field: the typed text, or null to abandon it. Only the first call is the answer,
   * because a cancel blurs the field and the blur must not then commit what the cancel threw away.
   */
  finish(value: string | null): void | Promise<unknown>
  /** Records what is in the field, since an uncontrolled one leaves nothing else to flush. */
  track(value: string): void
}

/**
 * @param initial what the field opened on, which is what a teardown commits if nothing was typed.
 * @param commit the write. Any promise it returns is what the shutdown handshake waits on.
 */
export function useFieldFlush(
  initial: string,
  commit: (value: string | null) => void | Promise<unknown>,
): FieldFlush {
  const done = useRef(false)
  // Tracked alongside the uncontrolled field so a teardown before Enter, Escape or a blur closed it
  // (navigating away, or the scene rebuilding under an open field) has something to flush. A blur
  // never fires for an element that is simply removed from the DOM.
  const latest = useRef(initial)
  // Read at commit time rather than captured, so the effect below runs once and still calls whatever
  // the last render passed.
  const write = useRef(commit)
  write.current = commit

  const finish = useCallback((value: string | null): void | Promise<unknown> => {
    if (done.current) {
      return
    }
    done.current = true
    return write.current(value)
  }, [])

  /** Set while a teardown's flush is queued, so the same field coming back can call it off. */
  const queued = useRef<{ cancelled: boolean } | null>(null)

  useEffect(() => {
    // In development React tears an effect down and sets it straight back up, to prove the teardown
    // is something the setup undoes. This one is not: flushing there closes the field in the frame
    // it opens, which leaves a label impossible to type into and commits a freshly made node empty.
    // So the flush waits a microtask, and only this same field's effect coming back calls it off. A
    // real teardown never returns, and a genuine remount is a new component with refs of its own.
    if (queued.current) {
      queued.current.cancelled = true
      queued.current = null
    }

    // Native window close does not unmount React. Await the write before the shutdown handshake
    // completes.
    const unregister = onShutdown(async () => finish(latest.current))

    return () => {
      unregister()
      const flush = { cancelled: false }
      queued.current = flush
      queueMicrotask(() => {
        if (flush.cancelled) {
          return
        }
        queued.current = null
        void finish(latest.current)
      })
    }
  }, [finish])

  return {
    finish,
    track: useCallback((value: string) => {
      latest.current = value
    }, []),
  }
}
