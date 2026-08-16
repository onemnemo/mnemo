import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { MenuItem, MenuSeparator } from "@/components/ui/menu"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"
import { cn } from "@/lib/utils"

import type { StyleTemplate } from "../../model/document"
import { MindmapThumbnail } from "../../page/MindmapThumbnail"
import type { FolderCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"
import { CardMenuButton } from "./CardMenuButton"

/**
 * A folder, wearing the newest map inside it.
 *
 * The borrowed thumbnail is deliberate: a wall of identical folder glyphs tells the user nothing,
 * while the shape of the map they last worked on inside a folder is often how they recognise it.
 * An empty folder falls back to the glyph, which is then meaningful rather than redundant.
 */
export function FolderCard({
  folder,
  templates,
  defaultTemplateId,
  actions,
  onOpen,
}: {
  folder: FolderCardModel
  templates: readonly StyleTemplate[]
  defaultTemplateId: string
  actions: LibraryActions
  onOpen: (id: string) => void
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)
  const [over, setOver] = useState(false)

  // An empty folder gets a dash where its date would be, the way the desktop writes it: it has no
  // date of its own to fall back to, and "updated just now" would be a lie about a folder nobody has
  // put anything in.
  const meta = mm("FolderMetaFormat")
    .replace("{0}", String(folder.mapCount))
    .replace("{1}", folder.modifiedAt ? formatSmart(folder.modifiedAt, Date.now(), t, language) : "—")

  return (
    <div
      className="group/card relative"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const id = event.dataTransfer.getData("text/plain")
        if (id) {
          void actions.fileMap(id, folder.id)
        }
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(folder.id)}
        className={cn(
          "block w-full overflow-hidden rounded-xl bg-canvas text-left transition-shadow",
          over
            ? "shadow-[0_0_0_2px_var(--accent)]"
            : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line),0_2px_8px_-4px_oklch(0_0_0/0.12)]",
        )}
      >
        <div className="relative">
          {folder.preview ? (
            <MindmapThumbnail
              document={folder.preview}
              templates={templates}
              defaultTemplateId={defaultTemplateId}
            />
          ) : (
            <div className="grid h-[132px] place-items-center bg-canvas-sunken">
              <AppIcon name="common/folder" size={26} className="text-ink-icon" />
            </div>
          )}
          {folder.preview ? (
            // A scrim under the glyph, because a thumbnail is arbitrary art and a bare icon over it
            // is only legible on the light maps.
            <div className="absolute left-2 top-2 grid size-7 place-items-center rounded-md bg-canvas/85 text-ink-2 backdrop-blur-sm">
              <AppIcon name="common/folder" size={15} />
            </div>
          ) : null}
        </div>
        <div className="px-3 py-2.5">
          <p className="truncate text-[13px] font-medium text-ink">{folder.folder.name}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-3">{meta}</p>
        </div>
      </button>

      <div className="absolute right-2 top-2">
        <CardMenuButton label={mm("FolderActions")}>
          <FolderMenuItems folder={folder} actions={actions} />
        </CardMenuButton>
      </div>
    </div>
  )
}

/** Shared with the list row, so a folder offers the same two verbs in either view. */
export function FolderMenuItems({
  folder,
  actions,
  leaving = false,
}: {
  folder: FolderCardModel
  actions: LibraryActions
  /** True when the folder being acted on is the one currently open, which the delete has to walk out of. */
  leaving?: boolean
}) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)

  return (
    <>
      <MenuItem icon="flyout/rename" onSelect={() => void actions.renameFolder(folder.folder)}>
        {mm("Rename")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="common/trash" danger onSelect={() => void actions.deleteFolder(folder.folder, leaving)}>
        {mm("Delete")}
      </MenuItem>
    </>
  )
}
