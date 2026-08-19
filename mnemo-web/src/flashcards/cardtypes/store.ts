import { create } from "zustand"

interface CardTypeManagerState {
  open: boolean
  /** Key of the type to select on open, for arriving from something that names one. */
  initialTypeId: string | null
  show: (typeId?: string | null) => void
  close: () => void
}

/**
 * Its own store for the same reason the review settings dialog has one: card types are collection
 * wide, so the dialog is reachable from anywhere and no screen should have to hold its state.
 */
export const useCardTypeManager = create<CardTypeManagerState>((set) => ({
  open: false,
  initialTypeId: null,
  show: (typeId = null) => set({ open: true, initialTypeId: typeId }),
  close: () => set({ open: false, initialTypeId: null }),
}))
