import { createAssetUrlCache, type AssetUrlCache } from "@/api/asset-cache"
import { readCachedNoteTitle } from "@/notes/api"
import { loadNoteAssetUrl } from "@/notes/assets/api"
import type { EditorServices } from "@/notes/editor/registry/types"

export interface PeekNoteServices {
  readonly services: Partial<EditorServices>
  /** Revokes every object URL handed out so far. A later read starts a fresh cache. */
  release(): void
}

/**
 * The editor services a read-only note gets in the peek: resolve an asset, resolve
 * another note's title, and nothing else.
 *
 * Deliberately not the bag the writable pane builds. That one carries `uploadAsset`,
 * which writes bytes to disk, and a note library with `createChild`, which creates a
 * note. Neither has any business behind a surface that cannot be edited, and handing
 * over the whole bag because it happens to contain the two reads is how a read-only
 * view ends up holding two write seams.
 */
export function createPeekNoteServices(): PeekNoteServices {
  // Lazily re-openable rather than one-shot, for the reason the note pane's cache is:
  // StrictMode runs the owning effect's cleanup and then remounts the same tree, and a
  // cache that stayed dead after that would reject every load the remount makes.
  let cache: AssetUrlCache | null = null
  const current = (): AssetUrlCache => (cache ??= createAssetUrlCache(loadNoteAssetUrl))

  return {
    services: {
      resolveNoteTitle: readCachedNoteTitle,
      loadAssetUrl: (path) => current().load(path),
    },
    release: () => {
      cache?.destroy()
      cache = null
    },
  }
}
