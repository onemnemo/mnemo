import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"
import { cn } from "@/lib/utils"

import type { FolderCardModel, MapCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"
import { LibraryContextMenu, LibraryMenuButton } from "./LibraryMenu"
import { DueBadge } from "./MapCard"
import { LAYOUT_LABEL_KEYS } from "./labels"
import { useFolderMenuEntries, useMapMenuEntries } from "./useLibraryMenuEntries"

const ROW_CLASS =
  "flex w-full items-center gap-3 rounded-xl bg-canvas px-3 py-2.5 text-left transition-shadow shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]"

/**
 * The list view.
 *
 * Same subjects and same verbs as the grid, in a shape that trades the thumbnail for a scannable
 * column of names. The overflow lives at the end of the row rather than floating over art, which is
 * why it is always visible here and hover-only on a card.
 */
export function FolderRow({
  folder,
  actions,
  onOpen,
}: {
  folder: FolderCardModel
  actions: LibraryActions
  onOpen: (id: string) => void
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)
  const [over, setOver] = useState(false)
  const entries = useFolderMenuEntries(folder, actions)

  const meta = mm("FolderMetaFormat")
    .replace("{0}", String(folder.mapCount))
    .replace("{1}", folder.modifiedAt ? formatSmart(folder.modifiedAt, Date.now(), t, language) : "—")

  return (
    <LibraryContextMenu entries={entries}>
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
          className={cn(ROW_CLASS, over && "shadow-[0_0_0_2px_var(--accent)]")}
        >
          <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-canvas-sunken text-accent">
            <AppIcon name="common/folder" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{folder.folder.name}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">{meta}</span>
          </span>
          {/* Space held for the menu, which is positioned over it. Without the gap the name could run
              under the button on a narrow window. */}
          <span className="size-7 shrink-0" />
        </button>

        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <LibraryMenuButton label={mm("FolderActions")} entries={entries} className={MENU_CLASS} />
        </div>
      </div>
    </LibraryContextMenu>
  )
}

export function MapRow({
  map,
  due,
  actions,
  onOpen,
}: {
  map: MapCardModel
  due: number
  actions: LibraryActions
  onOpen: (id: string) => void
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)
  const entries = useMapMenuEntries(map, actions)

  return (
    <LibraryContextMenu entries={entries}>
      <div
        className="group/card relative"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", map.id)
          event.dataTransfer.effectAllowed = "move"
        }}
      >
        <button type="button" onClick={() => onOpen(map.id)} className={ROW_CLASS}>
          <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-canvas-sunken text-ink-icon">
            <AppIcon name="common/sitemap" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{map.title || mm("UntitledMap")}</span>
            <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
              {mm("MapMetaFormat")
                .replace("{0}", String(map.nodeCount))
                .replace("{1}", formatSmart(map.modifiedAt, Date.now(), t, language))}
            </span>
          </span>
          {due > 0 ? <DueBadge due={due} className="shrink-0" /> : null}
          <span className="w-[52px] shrink-0 text-right font-mono text-[10px] uppercase tracking-wide text-ink-3">
            {mm(LAYOUT_LABEL_KEYS[map.layout] ?? "LayoutFree")}
          </span>
          <span className="size-7 shrink-0" />
        </button>

        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <LibraryMenuButton label={mm("MapActions")} entries={entries} className={MENU_CLASS} />
        </div>
      </div>
    </LibraryContextMenu>
  )
}

/** Always visible in a row: there is no thumbnail behind it to keep clean. */
const MENU_CLASS =
  "grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-frame-active hover:text-ink"
