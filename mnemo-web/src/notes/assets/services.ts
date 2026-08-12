// Assembles the editor-facing services for one open note: a session-scoped cache in front of
// the authenticated asset fetch, the upload that turns a picked file into a stored reference,
// and the note library a page block resolves its reference against. One instance per note
// load; releasing it revokes every object URL the note's views were handed, which is what
// "decoded images release on note close" means in practice.
//
// This is the one place that composes app data into the editor. The registry hands views a
// `services` handle precisely so a block module never imports a store or a client of its own,
// and that only holds if the wiring all lands here.

import { createAssetUrlCache, type AssetUrlCache } from "@/api/asset-cache"
import { useI18nStore } from "@/i18n/store"
import { createTranslate } from "@/i18n/translate"
import { toast } from "@/stores/toast"
import { createChildNote, noteListLoaded, readCachedNoteTitle, subscribeToNoteList } from "../api"
import type { EditorServices } from "../editor/registry/types"
import { loadNoteAssetUrl, uploadNoteAsset } from "./api"

/**
 * The note the editor is opening, taken from the route because the mount does not pass it
 * down yet. `NotePane` builds these services during the render that puts that note on
 * screen, so the hash is that note and not a guess. Pass the id in once the mount can.
 */
function hostNoteFromRoute(): string {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/")
  return parts[0] === "notes" ? (parts[1] ?? "") : ""
}

export interface NoteAssetServices {
  readonly services: Partial<EditorServices>
  /** Revokes every object URL handed out so far. A later load starts a fresh cache. */
  release(): void
}

export function createNoteAssetServices(hostNoteId?: string): NoteAssetServices {
  const host = hostNoteId ?? hostNoteFromRoute()
  // Lazily re-openable rather than one-shot: the editor state captures `services` once, but
  // React StrictMode runs the owning effect's cleanup and then remounts the same tree. A
  // cache that stayed dead after that cleanup would reject every load the remounted editor
  // makes; reopening on demand gives the remount a live cache and the real unmount still
  // revokes everything the last cache handed out.
  let cache: AssetUrlCache | null = null
  const current = (): AssetUrlCache => (cache ??= createAssetUrlCache(loadNoteAssetUrl))

  return {
    services: {
      resolveNoteTitle: readCachedNoteTitle,
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
      loadAssetUrl: (path) => current().load(path),
      uploadAsset: (file) => uploadNoteAsset(file).then((asset) => asset.assetId),
    },
    release: () => {
      cache?.destroy()
      cache = null
    },
  }
}
