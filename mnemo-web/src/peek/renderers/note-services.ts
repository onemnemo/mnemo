import { readCachedNoteTitle } from "@/notes/api"
import { noteAssetFault, noteAssetRequestPath } from "@/notes/assets/api"
import type { EditorServices } from "@/notes/editor/registry/types"

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
export const peekNoteServices: Partial<EditorServices> = {
  resolveNoteTitle: readCachedNoteTitle,
  assetUrl: noteAssetRequestPath,
  assetFault: noteAssetFault,
}
