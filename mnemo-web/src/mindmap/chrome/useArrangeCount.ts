import { useEffect, useRef, useState } from "react"

import type { ArrangeCount } from "../api"

/** Long enough that a burst of renders, a font load settling say, sends one request rather than several. */
export const ARRANGE_COUNT_DELAY = 150

/**
 * How many nodes an arrange would move right now, or null while that is not known.
 *
 * Asked whenever `asking` turns on, and again whenever the revision or `sizesKey` changes while it
 * stays on, since a restyle or a font load changes the sizes without a new revision. An answer only
 * counts for the revision and sizes it was asked with, and a request that is superseded is aborted.
 */
export function useArrangeCount(
  asking: boolean,
  revision: number,
  sizesKey: unknown,
  ask: (signal: AbortSignal) => Promise<ArrangeCount | null>,
): number | null {
  const [answer, setAnswer] = useState<{ reply: ArrangeCount; sizesKey: unknown } | null>(null)
  // The route hands over a fresh closure every render, and asking again for each would send a request
  // per render.
  const latest = useRef(ask)
  useEffect(() => {
    latest.current = ask
  })

  useEffect(() => {
    if (!asking) return
    const aborter = new AbortController()
    const timer = setTimeout(() => {
      latest.current(aborter.signal).then(
        (reply) => {
          if (!aborter.signal.aborted && reply) setAnswer({ reply, sizesKey })
        },
        // Unknown leaves the button usable, which is the safe way to be wrong.
        () => {},
      )
    }, ARRANGE_COUNT_DELAY)
    return () => {
      clearTimeout(timer)
      aborter.abort()
    }
  }, [asking, revision, sizesKey])

  return answer && answer.reply.revision === revision && answer.sizesKey === sizesKey ? answer.reply.moves : null
}
