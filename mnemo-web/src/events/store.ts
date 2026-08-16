import { create } from "zustand"

import type { ConnectionStatus } from "./types"

// Live connection state for the app-events channel. The provider writes it; a
// future offline/reconnecting indicator in the chrome will read from here.
interface EventStreamState {
  status: ConnectionStatus
  setStatus: (status: ConnectionStatus) => void
}

export const useEventStreamStore = create<EventStreamState>((set) => ({
  status: "connecting",
  setStatus: (status) => set({ status }),
}))
