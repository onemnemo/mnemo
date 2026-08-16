import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { formatSmart } from "@/lib/relative-date"

import type { StyleTemplate } from "../../model/document"
import { MindmapThumbnail } from "../../page/MindmapThumbnail"
import type { MapCardModel } from "../shelf"

/**
 * The three most recently touched maps, wherever they are filed.
 *
 * Deliberately not folder-scoped: this is the row that gets you back to what you were doing, and a
 * map two folders down is exactly the one that is hard to find again by browsing.
 */
export function RecentStrip({
  maps,
  folderNames,
  templates,
  defaultTemplateId,
  onOpen,
}: {
  maps: readonly MapCardModel[]
  folderNames: ReadonlyMap<string, string>
  templates: readonly StyleTemplate[]
  defaultTemplateId: string
  onOpen: (id: string) => void
}) {
  const t = useT()
  const language = useI18nStore((state) => state.language)
  const mm = (key: string) => t("Mindmap", key)

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{mm("JumpBackIn")}</h2>
      <div className="grid grid-cols-3 gap-3">
        {maps.map((map) => {
          const when = formatSmart(map.modifiedAt, Date.now(), t, language)
          const folder = folderNames.get(map.id)
          return (
            <button
              key={map.id}
              type="button"
              onClick={() => onOpen(map.id)}
              className="flex items-center gap-3 rounded-xl bg-canvas p-2.5 text-left shadow-[0_0_0_1px_var(--line-soft)] transition-shadow hover:shadow-[0_0_0_1px_var(--line),0_2px_8px_-4px_oklch(0_0_0/0.12)]"
            >
              <div className="h-[54px] w-[72px] shrink-0 overflow-hidden rounded-lg [&_svg]:h-full">
                <MindmapThumbnail
                  document={map.document}
                  templates={templates}
                  defaultTemplateId={defaultTemplateId}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{map.title || mm("UntitledMap")}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
                  {folder ? mm("MapContextFormat").replace("{0}", folder).replace("{1}", when) : when}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
