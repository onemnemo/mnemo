import { useState } from "react"

import { navigate } from "@/app/router"
import { useT } from "@/i18n/useT"
import { dialog } from "@/stores/dialog"

import {
  useCreateMindmap,
  useDeleteMindmap,
  useDeleteMindmapFolder,
  useDuplicateMindmap,
  useMoveMindmapToFolder,
  useRenameMindmap,
  useSaveMindmapFolder,
} from "../api"
import type { MindmapFolder } from "../model/document"
import { useLibraryView } from "./store"

/**
 * The library's verbs, in one place because the grid and the list offer the same ones and a card and
 * a row must not disagree about what "delete" asks first.
 *
 * Each verb owns its own confirmation. A menu item that opens a dialog and a menu item that acts
 * immediately look identical, so the decision belongs with the action rather than with whichever
 * surface happened to render the row.
 */
export function useLibraryActions() {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  const create = useCreateMindmap()
  const rename = useRenameMindmap()
  const duplicate = useDuplicateMindmap()
  const remove = useDeleteMindmap()
  const move = useMoveMindmapToFolder()
  const saveFolder = useSaveMindmapFolder()
  const removeFolder = useDeleteMindmapFolder()

  const folderId = useLibraryView((state) => state.folderId)
  const openFolder = useLibraryView((state) => state.openFolder)

  // Held here rather than in the header, because three surfaces offer "new map" and all three have
  // to raise the same dialog.
  const [creating, setCreating] = useState(false)

  async function createFolder(parentId: string | null) {
    const name = await dialog.prompt({
      title: mm("CreateFolderTitle"),
      defaultValue: mm("NewFolderName"),
      placeholder: mm("NamePlaceholder"),
      confirmLabel: mm("Create"),
      cancelLabel: mm("Cancel"),
    })
    const trimmed = name?.trim()
    if (!trimmed) {
      return
    }
    // The id is minted here because the folder endpoint is a PUT: the store writes whatever id it is
    // handed, and there is no server-side create call to mint one instead.
    await saveFolder.mutateAsync({ id: crypto.randomUUID(), name: trimmed, parentId })
  }

  return {
    /** True while any of them is in flight, which is what disables the New button. */
    busy:
      create.isPending ||
      rename.isPending ||
      duplicate.isPending ||
      remove.isPending ||
      saveFolder.isPending ||
      removeFolder.isPending,

    /** Whether the new-map dialog is up. The route mounts it; every "new map" control opens it. */
    creating,

    createMapHere: () => setCreating(true),

    cancelCreate: () => setCreating(false),

    /**
     * Creates in the folder on screen and opens it, because a map made from the gallery is a map
     * somebody is about to draw on. Landing back on the gallery would cost a second click every time.
     */
    async confirmCreate(title: string, templateId: string | null) {
      const document = await create.mutateAsync({ title, templateId: templateId ?? undefined, folderId })
      setCreating(false)
      navigate("mindmap", document.id)
    },

    createFolderHere: () => createFolder(folderId),

    async renameMap(id: string, current: string) {
      const title = await dialog.prompt({
        title: mm("Rename"),
        defaultValue: current,
        placeholder: mm("CreateMapNamePlaceholder"),
        confirmLabel: mm("Save"),
        cancelLabel: mm("Cancel"),
      })
      const trimmed = title?.trim()
      if (!trimmed || trimmed === current) {
        return
      }
      await rename.mutateAsync({ id, title: trimmed })
    },

    async duplicateMap(id: string) {
      await duplicate.mutateAsync({ id })
    },

    async deleteMap(id: string, title: string) {
      const ok = await dialog.confirm({
        title: mm("DeleteMapTitle"),
        message: mm("DeleteMapConfirm").replace("{0}", title || mm("UntitledMap")),
        destructive: true,
        confirmLabel: mm("Delete"),
        cancelLabel: mm("Cancel"),
      })
      if (ok) {
        await remove.mutateAsync(id)
      }
    },

    async renameFolder(folder: MindmapFolder) {
      const name = await dialog.prompt({
        title: mm("RenameFolderTitle"),
        defaultValue: folder.name,
        placeholder: mm("NamePlaceholder"),
        confirmLabel: mm("Save"),
        cancelLabel: mm("Cancel"),
      })
      const trimmed = name?.trim()
      if (!trimmed || trimmed === folder.name) {
        return
      }
      await saveFolder.mutateAsync({ ...folder, name: trimmed })
    },

    async deleteFolder(folder: MindmapFolder, leaving: boolean) {
      const ok = await dialog.confirm({
        title: mm("DeleteFolderTitle"),
        message: mm("DeleteFolderConfirm").replace("{0}", folder.name),
        destructive: true,
        confirmLabel: mm("Delete"),
        cancelLabel: mm("Cancel"),
      })
      if (!ok) {
        return
      }
      // Walking out first when the folder being deleted is the one on screen. Deleting it underneath
      // the view would leave the page showing a folder that no longer exists until the refetch lands.
      if (leaving) {
        openFolder(folder.parentId ?? null)
      }
      await removeFolder.mutateAsync(folder.id)
    },

    async fileMap(id: string, target: string | null) {
      await move.mutateAsync({ id, folderId: target })
    },
  }
}

export type LibraryActions = ReturnType<typeof useLibraryActions>
