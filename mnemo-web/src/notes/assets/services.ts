// Assembles the editor-facing asset services for one open note: a session-scoped cache in
// front of the authenticated fetch, and the upload that turns a picked file into a stored
// reference. One instance per note load; releasing it revokes every object URL the note's
// views were handed, which is what "decoded images release on note close" means in practice.

import { createAssetUrlCache, type AssetUrlCache } from "@/api/asset-cache"
import type { EditorServices } from "../editor/registry/types"
import { loadNoteAssetUrl, uploadNoteAsset } from "./api"

export interface NoteAssetServices {
  readonly services: Partial<EditorServices>
  /** Revokes every object URL handed out so far. A later load starts a fresh cache. */
  release(): void
}

export function createNoteAssetServices(): NoteAssetServices {
  // Lazily re-openable rather than one-shot: the editor state captures `services` once, but
  // React StrictMode runs the owning effect's cleanup and then remounts the same tree. A
  // cache that stayed dead after that cleanup would reject every load the remounted editor
  // makes; reopening on demand gives the remount a live cache and the real unmount still
  // revokes everything the last cache handed out.
  let cache: AssetUrlCache | null = null
  const current = (): AssetUrlCache => (cache ??= createAssetUrlCache(loadNoteAssetUrl))

  return {
    services: {
      loadAssetUrl: (path) => current().load(path),
      uploadAsset: (file) => uploadNoteAsset(file).then((asset) => asset.assetId),
    },
    release: () => {
      cache?.destroy()
      cache = null
    },
  }
}
