import { useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { useSettingValue } from "@/settings/store"

import { useOverviewStore } from "../store"
import { allWidgets } from "../widgets/registry"
import { LIBRARY_CATEGORIES, type LibraryFilter } from "./categories"
import { matches, searchBlob } from "./search"
import { WidgetLibraryCard } from "./WidgetLibraryCard"

/**
 * The gallery.
 *
 * A real modal, unlike the panel this replaces. The board behind it is not meant to be operable
 * while it is open, and `isModalOpen()` reads the `role="dialog"` the Modal stamps, so every window
 * shortcut is suppressed for as long as it is up. Escape belongs to the Modal for the same reason;
 * the route's edit-mode handler sees the press stopped before it can end the session.
 */
export function WidgetLibraryPanel() {
  const t = useT()
  const bundle = useI18nStore((state) => state.bundle)
  const isOpen = useOverviewStore((state) => state.isLibraryOpen)
  const closeLibrary = useOverviewStore((state) => state.closeLibrary)
  const addWidget = useOverviewStore((state) => state.addWidget)
  const draft = useOverviewStore((state) => state.draft)

  // Soma is a whole thing behind one switch, so its widget goes with the rest of the surface rather
  // than sitting in the gallery advertising an assistant this build has turned off.
  const aiEnabled = useSettingValue("AI.EnableAssistant", false)

  const [filter, setFilter] = useState<LibraryFilter>("all")
  const [query, setQuery] = useState("")

  // Live per-type count off the draft, recomputed as tiles are added or removed behind the dialog.
  const counts = useMemo(() => {
    const byId = new Map<string, number>()
    for (const widget of draft) byId.set(widget.widgetId, (byId.get(widget.widgetId) ?? 0) + 1)
    return byId
  }, [draft])

  const entries = useMemo(() => {
    return allWidgets()
      .filter(({ manifest }) => aiEnabled || manifest.category !== "soma")
      .map(({ manifest }) => {
        const title = t(manifest.ns, manifest.displayNameKey ?? "Title")
        const description = t(manifest.ns, manifest.descriptionKey ?? "Description")
        // The gallery description is only authored for some widgets; fall back to the short one
        // rather than render the raw key a plain miss would return.
        const gallery = bundle[manifest.ns]?.["GalleryDescription"] ?? ""
        return {
          manifest,
          title,
          description: gallery || description,
          blob: searchBlob({ title, description, gallery, author: manifest.author }),
        }
      })
  }, [t, bundle, aiEnabled])

  const shown = entries.filter(
    (entry) => (filter === "all" || entry.manifest.category === filter) && matches(entry.blob, query),
  )

  return (
    <Modal
      open={isOpen}
      onClose={closeLibrary}
      title={t("WidgetLibrary", "Title")}
      closeLabel={t("WidgetLibrary", "Close")}
      width={900}
      className="h-[min(680px,88vh)]"
      headerRight={
        <div className="flex h-8 w-[240px] items-center gap-1.5 rounded-lg bg-canvas-sunken px-2.5 focus-within:shadow-[0_0_0_1px_var(--line)]">
          <AppIcon name="search" size={14} strokeWidth={1.7} className="shrink-0 text-ink-icon" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("WidgetLibrary", "SearchPlaceholder")}
            aria-label={t("WidgetLibrary", "SearchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </div>
      }
      footer={
        <>
          <p className="text-[12px] text-ink-3">{t("WidgetLibrary", "StoreTeaser")}</p>
          <Button onClick={closeLibrary}>{t("WidgetLibrary", "Done")}</Button>
        </>
      }
    >
      <nav aria-label={t("WidgetLibrary", "Categories")} className="w-[168px] shrink-0 space-y-px overflow-y-auto px-3 pb-4">
        {LIBRARY_CATEGORIES.map((category) => {
          const count =
            category.id === "all"
              ? entries.length
              : entries.filter((entry) => entry.manifest.category === category.id).length
          const selected = filter === category.id
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(category.id)}
              className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
                selected ? "bg-frame-active font-medium text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink"
              }`}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              <span className="min-w-0 flex-1 truncate text-left">{t("WidgetLibrary", category.labelKey)}</span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">{count || ""}</span>
            </button>
          )
        })}
      </nav>

      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto px-5 pb-5">
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <AppIcon name="store" size={24} strokeWidth={1.4} className="text-ink-icon" />
            <p className="text-[13px] text-ink-2">
              {filter === "community" ? t("WidgetLibrary", "CommunityEmpty") : t("WidgetLibrary", "NoResults")}
            </p>
            <p className="max-w-[280px] text-[12px] text-ink-3">
              {filter === "community" ? t("WidgetLibrary", "CommunityEmptyHint") : t("WidgetLibrary", "NoResultsHint")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {shown.map((entry) => (
              <WidgetLibraryCard
                key={entry.manifest.widgetId}
                manifest={entry.manifest}
                title={entry.title}
                description={entry.description}
                count={counts.get(entry.manifest.widgetId) ?? 0}
                onAdd={(size) => addWidget(entry.manifest, size)}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
