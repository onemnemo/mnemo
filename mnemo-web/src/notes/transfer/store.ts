import { create } from "zustand"

/** What an export covers. Null when the caller only offers import. */
export interface NoteTransferScope {
  /** How the scope reads in the dialog, e.g. the note's own title. */
  label: string
  /** For a folder, the notes in its subtree; the host adds child pages to either. */
  noteIds: string[]
  /** Folders exported whole, structure included. */
  folderIds?: string[]
  /** The file's name when the label is not it, e.g. a folder labelled by its full path. */
  fileName?: string
}

/** Where an import files its notes. A package hangs its own folders under it. */
export interface NoteImportDestination {
  folderId: string
  /** The folder's name, so the dialog can say where the notes are going. */
  label: string
}

export interface NoteTransferTarget {
  /** Directions on offer. A single one hides the toggle and fixes the dialog to that side. */
  direction: "import" | "export" | "both"
  scope: NoteTransferScope | null
  /** The folder an import lands in. Absent means the library root. */
  destination?: NoteImportDestination | null
}

interface NoteTransferState {
  target: NoteTransferTarget | null
  open: (target: NoteTransferTarget) => void
  close: () => void
}

/**
 * Which note transfer dialog is open, if any. A store rather than local state because the entry
 * points are far apart in the tree, the sidebar header and a note's breadcrumb and row menu, and a
 * menu item cannot own a dialog that has to outlive the menu closing.
 */
export const useNoteTransfer = create<NoteTransferState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
