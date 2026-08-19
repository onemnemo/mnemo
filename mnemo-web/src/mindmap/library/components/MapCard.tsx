import { AppIcon } from "@/components/icon/AppIcon"
import { MenuItem, MenuSeparator } from "@/components/ui/menu"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"
import { cn } from "@/lib/utils"

import type { StyleTemplate } from "../../model/document"
import { MindmapThumbnail } from "../../page/MindmapThumbnail"
import { useMindmapTransfer } from "../../transfer/store"
import type { MapCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"
import { CardMenuButton } from "./CardMenuButton"
import { LAYOUT_LABEL_KEYS } from "./labels"

/**
 * One map in the gallery, drawn as itself.
 *
 * Draggable onto a folder card or a crumb, which is the only way to file a map. The id travels as
 * plain text: a drop target cannot read a custom MIME payload until the drop lands, and a folder has
 * to know a map is coming while the pointer is still over it in order to light up.
 */
export function MapCard({
  map,
  templates,
  defaultTemplateId,
  due,
  actions,
  onOpen,
}: {
  map: MapCardModel
  templates: readonly StyleTemplate[]
  defaultTemplateId: string
  due: number
  actions: LibraryActions
  onOpen: (id: string) => void
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)
  const title = map.title || mm("UntitledMap")

  return (
    <div
      className="group/card relative"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", map.id)
        event.dataTransfer.effectAllowed = "move"
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(map.id)}
        className="block w-full overflow-hidden rounded-xl bg-canvas text-left shadow-[0_0_0_1px_var(--line-soft)] transition-shadow hover:shadow-[0_0_0_1px_var(--line),0_2px_8px_-4px_oklch(0_0_0/0.12)]"
      >
        <div className="relative">
          <MindmapThumbnail document={map.document} templates={templates} defaultTemplateId={defaultTemplateId} />
          {due > 0 ? <DueBadge due={due} className="absolute left-2 top-2" /> : null}
        </div>
        <div className="flex items-baseline gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
              {mm("MapMetaFormat")
                .replace("{0}", String(map.nodeCount))
                .replace("{1}", formatSmart(map.modifiedAt, Date.now(), t, language))}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-ink-3">
            {mm(LAYOUT_LABEL_KEYS[map.layout] ?? "LayoutFree")}
          </span>
        </div>
      </button>

      <div className="absolute right-2 top-2">
        <CardMenuButton label={mm("MapActions")}>
          <MapMenuItems map={map} actions={actions} />
        </CardMenuButton>
      </div>
    </div>
  )
}

/** Cards waiting in the decks a map links to, which is the one number worth pulling in from study. */
export function DueBadge({ due, className }: { due: number; className?: string }) {
  const t = useT()

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-accent-wash px-2 py-0.5 text-[11px] font-medium text-accent-ink",
        className,
      )}
    >
      <AppIcon name="sidebar/flashcard" size={10} />
      {t("Mindmap", "DueCountFormat").replace("{0}", String(due))}
    </span>
  )
}

/** The same verbs behind a card's overflow and a list row's, so the two cannot drift apart. */
export function MapMenuItems({ map, actions }: { map: MapCardModel; actions: LibraryActions }) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)
  const openTransfer = useMindmapTransfer((state) => state.open)
  const title = map.title || mm("UntitledMap")

  return (
    <>
      <MenuItem icon="flyout/rename" onSelect={() => void actions.renameMap(map.id, map.title)}>
        {mm("Rename")}
      </MenuItem>
      <MenuItem icon="common/copy" onSelect={() => void actions.duplicateMap(map.id)}>
        {mm("Duplicate")}
      </MenuItem>
      <MenuItem
        icon="common/upload"
        onSelect={() => openTransfer({ direction: "export", scope: { label: title, mapIds: [map.id] } })}
      >
        {mm("Export")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="common/trash" danger onSelect={() => void actions.deleteMap(map.id)}>
        {mm("Delete")}
      </MenuItem>
    </>
  )
}
