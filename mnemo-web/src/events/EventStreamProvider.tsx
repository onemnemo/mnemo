import { useEffect, type ReactNode } from "react"

import { dispatchAppEvent } from "./dispatch"
import { connectEventStream } from "./sse-client"
import { useEventStreamStore } from "./store"

// Owns the single app-events connection for the session. Mounted once near the
// app root; it renders children unchanged - the stream is a side channel, not a
// gate on the UI.
export function EventStreamProvider({ children }: { children: ReactNode }) {
  const setStatus = useEventStreamStore((s) => s.setStatus)

  useEffect(() => {
    const dispose = connectEventStream({
      onEvent: dispatchAppEvent,
      onOpen: () => setStatus("open"),
      onClose: () => setStatus("closed"),
    })
    return dispose
  }, [setStatus])

  return <>{children}</>
}
