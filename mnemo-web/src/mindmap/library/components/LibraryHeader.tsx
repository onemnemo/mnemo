import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"

import { useMindmapTransfer } from "../../transfer/store"
import type { FolderCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"
import { FolderMenuItems } from "./FolderCard"

/**
 * The page head: what you are looking at, what is in it, and what you can add.
 *
 * The root and a folder are the same header with different subjects, which is why one component
 * draws both. Splitting them duplicated the New menu, and the two copies drifted on the desktop.
 */
export function LibraryHeader({
  folder,
  mapCount,
  folderCount,
  dueCount,
  allMapIds,
  actions,
}: {
  /** Null at the root, where the header names the module instead of a folder. */
  folder: FolderCardModel | null
  mapCount: number
  folderCount: number
  dueCount: number
  /** Every map in the library, which is what the root's export offers. */
  allMapIds: readonly string[]
  actions: LibraryActions
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)
  const openTransfer = useMindmapTransfer((state) => state.open)

  const updated = folder?.modifiedAt ? formatSmart(folder.modifiedAt, Date.now(), t, language) : "—"
  const countLine = folder
    ? dueCount > 0
      ? mm("FolderHeaderDueFormat")
          .replace("{0}", String(folder.mapCount))
          .replace("{1}", String(dueCount))
          .replace("{2}", updated)
      : mm("FolderHeaderFormat").replace("{0}", String(folder.mapCount)).replace("{1}", updated)
    : mm("RootCountFormat").replace("{0}", String(mapCount)).replace("{1}", String(folderCount))

  return (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {folder ? (
          <div className="grid size-[38px] shrink-0 place-items-center rounded-lg bg-canvas-sunken text-accent">
            <AppIcon name="common/folder" size={19} />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {folder ? folder.folder.name : mm("Title")}
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">{countLine}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {folder ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline" aria-label={mm("FolderActions")} title={mm("FolderActions")} className="px-2">
                <AppIcon name="common/dots-vertical" size={16} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              {/* Deleting the folder you are standing in has to walk out of it first, which is what
                  the flag tells the action. */}
              <FolderMenuItems folder={folder} actions={actions} leaving />
            </MenuContent>
          </Menu>
        ) : (
          // Root only. An imported package restores the folders its maps were filed in, so there is
          // nothing a folder's own Transfer button would do differently than this one.
          <Button
            variant="outline"
            icon={<AppIcon name="common/download" size={15} />}
            onClick={() =>
              openTransfer({
                direction: "both",
                scope: { label: mm("TransferScopeAllMindmaps"), mapIds: [...allMapIds] },
              })
            }
          >
            {mm("Transfer")}
          </Button>
        )}

        <Menu>
          <MenuTrigger asChild>
            <Button icon={<AppIcon name="plus" size={14} strokeWidth={1.9} />} disabled={actions.busy}>
              {mm("New")}
            </Button>
          </MenuTrigger>
          <MenuContent align="end" opensDialog>
            <MenuItem icon="common/sitemap" onSelect={actions.createMapHere}>
              {mm("NewMenuMap")}
            </MenuItem>
            <MenuItem icon="common/folder" onSelect={() => void actions.createFolderHere()}>
              {mm("NewMenuFolder")}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  )
}
