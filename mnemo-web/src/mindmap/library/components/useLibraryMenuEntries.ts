import { useT } from "@/i18n/useT"

import { useMindmapTransfer } from "../../transfer/store"
import { folderMenuItems, mapMenuItems, type LibraryMenuEntry } from "../menu-items"
import type { FolderCardModel, MapCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"

/**
 * Binds the library's verb lists to the actions the route hands every card and row.
 *
 * The lists are rebuilt on every render rather than captured on the press that raises
 * a menu: Shift+F10 and the Menu key fire a `contextmenu` with no pointer event before
 * it, so anything remembered from a press would be stale.
 */
export function useMapMenuEntries(map: MapCardModel, actions: LibraryActions): readonly LibraryMenuEntry[] {
  const t = useT()
  const openTransfer = useMindmapTransfer((state) => state.open)
  const title = map.title || t("Mindmap", "UntitledMap")

  return mapMenuItems({
    t,
    on: {
      rename: () => void actions.renameMap(map.id, map.title),
      duplicate: () => void actions.duplicateMap(map.id),
      export: () => openTransfer({ direction: "export", scope: { label: title, mapIds: [map.id] } }),
      remove: () => void actions.deleteMap(map.id),
    },
  })
}

export function useFolderMenuEntries(
  folder: FolderCardModel,
  actions: LibraryActions,
  /** True when the folder being acted on is the one currently open, which the delete has to walk out of. */
  leaving = false,
): readonly LibraryMenuEntry[] {
  const t = useT()

  return folderMenuItems({
    t,
    on: {
      rename: () => void actions.renameFolder(folder.folder),
      remove: () => void actions.deleteFolder(folder.folder, leaving),
    },
  })
}
