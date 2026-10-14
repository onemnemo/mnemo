// Editor services for one open note: image URLs, upload, and the note library a page block
// resolves against.
//
// This is the one place that composes app data into the editor. The registry hands views a
// `services` handle precisely so a block module never imports a store or a client of its own,
// and that only holds if the wiring all lands here.

import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"
import {
  createChildNote,
  noteListLoaded,
  readCachedNoteEmoji,
  readCachedNoteTitle,
  subscribeToNoteList,
} from "../api"
import type { EditorServices } from "../editor/registry/types"
import { noteAssetFault, noteAssetRequestPath, uploadNoteAsset } from "./api"

/**
 * The note the editor is opening, taken from the route because the mount does not pass it
 * down yet. `NotePane` builds these services during the render that puts that note on
 * screen, so the hash is that note and not a guess. Pass the id in once the mount can.
 */
function hostNoteFromRoute(): string {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/")
  return parts[0] === "notes" ? (parts[1] ?? "") : ""
}

export function createNoteAssetServices(hostNoteId?: string): Partial<EditorServices> {
  const host = hostNoteId ?? hostNoteFromRoute()

  return {
    resolveNoteTitle: readCachedNoteTitle,
    resolveNoteEmoji: readCachedNoteEmoji,
    notes: {
      isLoaded: noteListLoaded,
      subscribe: subscribeToNoteList,
      createChild: async () => {
        try {
          return await createChildNote(host)
        } catch (error) {
          // Nothing is inserted when this fails, so without a word the menu row
          // would read as a click that did nothing.
          toast.warning(createTranslate(useI18nStore.getState().bundle)("App", "MutationErrorTitle"))
          throw error
        }
      },
    },
    assetUrl: noteAssetRequestPath,
    assetFault: noteAssetFault,
    uploadAsset: (file) => uploadNoteAsset(file).then((asset) => asset.assetId),
  }
}
