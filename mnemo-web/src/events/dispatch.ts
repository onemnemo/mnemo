import { completeShutdown } from "@/app/shutdown"
import { useToastStore } from "@/stores/toast"

import { EventType, type AppEvent, type ToastEventData } from "./types"

// The single place that turns a server event into an app-state change. New event
// types get a case here; the transport (sse-client) and the provider stay
// untouched. Payloads are trusted - they come from the same-origin loopback host.
export function dispatchAppEvent(event: AppEvent): void {
  switch (event.type) {
    case EventType.Toast: {
      const toast = event.data as ToastEventData
      useToastStore.getState().spawn(toast.type, toast.title, {
        description: toast.description ?? undefined,
        durationMs: toast.durationMs,
      })
      break
    }
    case EventType.Shutdown:
      // Not awaited: the dispatcher is synchronous, and the handshake reports
      // itself to the host rather than back through here.
      void completeShutdown()
      break
    case EventType.Hello:
      // Handshake only; connection status is set by the provider's onOpen.
      break
    default:
      break
  }
}
