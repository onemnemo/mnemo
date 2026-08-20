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
    // StrictMode mounts this effect twice, so the connection opened here is
    // torn down again before the surviving one even exists. A token captured
    // per invocation, the same shape session/store.ts uses for its own
    // StrictMode race, keeps a callback that still arrives from that discarded
    // connection from being mistaken for one from the connection that replaced it.
    let live = true

    const dispose = connectEventStream({
      onEvent: (event) => { if (live) dispatchAppEvent(event) },
      onOpen: () => { if (live) setStatus("open") },
      onClose: () => { if (live) setStatus("closed") },
    })

    return () => {
      live = false
      dispose()
    }
  }, [setStatus])

  return <>{children}</>
}
