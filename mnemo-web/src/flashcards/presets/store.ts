import { create } from "zustand"

/**
 * What the dialog was opened for. A deck is optional: opened from a deck it can also re-bind
 * that deck to a different preset, opened from a session topbar it only edits presets.
 */
export interface ReviewSettingsTarget {
  deckId: string | null
  deckName: string | null
}

interface ReviewSettingsState {
  target: ReviewSettingsTarget | null
  open: (deckId?: string | null, deckName?: string | null) => void
  close: () => void
}

/**
 * Its own store for the same reason the card editor has one: four screens open this dialog and
 * none of them should have to hold its state.
 */
export const useReviewSettings = create<ReviewSettingsState>((set) => ({
  target: null,
  open: (deckId = null, deckName = null) => set({ target: { deckId, deckName } }),
  close: () => set({ target: null }),
}))
