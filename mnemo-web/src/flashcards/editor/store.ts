import { create } from "zustand"

/**
 * What the editor was opened for. The deck id rides along in edit mode as well as add mode so
 * the caller's deck keys can be invalidated without first waiting for the card to load.
 */
export type CardEditorTarget =
  | { kind: "add"; deckId: string }
  | { kind: "edit"; deckId: string; cardId: string }

interface CardEditorState {
  target: CardEditorTarget | null
  openAdd: (deckId: string) => void
  openEdit: (deckId: string, cardId: string) => void
  close: () => void
}

/**
 * Opening the editor is a separate store from the deck view because the study and test screens
 * open the same dialog, and none of them should have to own its state.
 */
export const useCardEditor = create<CardEditorState>((set) => ({
  target: null,
  openAdd: (deckId) => set({ target: { kind: "add", deckId } }),
  openEdit: (deckId, cardId) => set({ target: { kind: "edit", deckId, cardId } }),
  close: () => set({ target: null }),
}))
