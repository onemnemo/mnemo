import { useMemo, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { IconButton } from "@/components/ui/icon-button"
import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"

import { useOverviewStore } from "../store"
import type { WidgetManifest } from "../widgets/manifest"
import { allWidgets } from "../widgets/registry"
import { matches, searchBlob } from "./search"
import { WidgetLibraryRow, type LibraryRowModel } from "./WidgetLibraryRow"

/** "" for none, "On grid" for one, "On grid ×n" for more, matching the desktop's split. */
function onGridText(count: number, t: ReturnType<typeof useT>): string {
  if (count <= 0) return ""
  if (count === 1) return t("WidgetLibrary", "OnGrid")
  return t("WidgetLibrary", "OnGridCountFormat", { 0: count })
}

function sizesText(manifest: WidgetManifest): string {
  return manifest.supportedSizes.map((size) => `${size.columns}×${size.rows}`).join(" · ")
}

/**
 * The right-docked widget picker.
 *
 * A plain positioned <aside>, not a Radix Dialog, on purpose: it is non-modal, the board behind it
 * stays live, and a Dialog would stamp role="dialog" on the DOM and silence every window shortcut
 * while it is open, the board's own Escape included. Escape here is owned by the route's edit-mode
 * handler, which closes the panel before it would cancel the session.
 */
export function WidgetLibraryPanel() {
  const t = useT()
  const bundle = useI18nStore((state) => state.bundle)
  const isOpen = useOverviewStore((state) => state.isLibraryOpen)
  const closeLibrary = useOverviewStore((state) => state.closeLibrary)
  const addWidget = useOverviewStore((state) => state.addWidget)
  const draft = useOverviewStore((state) => state.draft)

  const [query, setQuery] = useState("")

  // Live per-type count off the draft, recomputed as tiles are added or removed behind the panel.
  const counts = useMemo(() => {
    const byId = new Map<string, number>()
    for (const widget of draft) byId.set(widget.widgetId, (byId.get(widget.widgetId) ?? 0) + 1)
    return byId
  }, [draft])

  const rows = useMemo<(LibraryRowModel & { blob: string })[]>(() => {
    return allWidgets().map(({ manifest }) => {
      const title = t(manifest.ns, manifest.displayNameKey ?? "Title")
      const description = t(manifest.ns, manifest.descriptionKey ?? "Description")
      // The gallery description is only authored for some widgets; fall back to the short one rather
      // than render the raw key that a plain miss would return.
      const gallery = bundle[manifest.ns]?.["GalleryDescription"] ?? ""
      return {
        manifest,
        title,
        description: gallery || description,
        sizesText: sizesText(manifest),
        bylineText: manifest.sourceExtensionId ? t("WidgetLibrary", "BylineFormat", { 0: manifest.author }) : "",
        onGridText: onGridText(counts.get(manifest.widgetId) ?? 0, t),
        isExtension: manifest.sourceExtensionId !== undefined,
        blob: searchBlob({ title, description, gallery, author: manifest.author }),
      }
    })
  }, [t, bundle, counts])

  if (!isOpen) return null

  const visible = rows.filter((row) => matches(row.blob, query))
  const builtIn = visible.filter((row) => !row.isExtension)
  const extensions = visible.filter((row) => row.isExtension)

  return (
    <aside
      aria-label={t("WidgetLibrary", "Title")}
      className="fixed right-4 top-4 bottom-4 z-40 flex w-[340px] flex-col rounded-xl border border-line bg-card p-4 shadow-elevation-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-heading-5 font-semibold text-text-primary">{t("WidgetLibrary", "Title")}</h2>
        <IconButton
          icon="common/x"
          iconSize={14}
          label={t("WidgetLibrary", "Close")}
          className="-mt-0.5 -mr-0.5"
          onClick={closeLibrary}
        />
      </div>

      <div className="relative mt-3">
        <AppIcon
          name="common/search"
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-faded"
        />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("WidgetLibrary", "SearchPlaceholder")}
          aria-label={t("WidgetLibrary", "SearchPlaceholder")}
          className="h-8 w-full rounded-md border border-line bg-surface pr-2.5 pl-8 text-body-small text-text-primary outline-none placeholder:text-text-faded focus:border-brand"
        />
      </div>

      {visible.length === 0 ? (
        <p className="mx-1 mt-4 text-body-small text-text-tertiary">{t("WidgetLibrary", "NoResults")}</p>
      ) : null}

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto pt-2">
        {builtIn.length > 0 ? (
          <>
            <p className="mx-1 mt-1 mb-1.5 text-caption font-semibold text-text-tertiary">
              {t("WidgetLibrary", "BuiltInSection")}
            </p>
            {builtIn.map((row) => (
              <WidgetLibraryRow key={row.manifest.widgetId} model={row} onAdd={() => addWidget(row.manifest)} />
            ))}
          </>
        ) : null}

        {extensions.length > 0 ? (
          <>
            <p className="mx-1 mt-3 mb-1.5 text-caption font-semibold text-text-tertiary">
              {t("WidgetLibrary", "ExtensionsSection")}
            </p>
            {extensions.map((row) => (
              <WidgetLibraryRow key={row.manifest.widgetId} model={row} onAdd={() => addWidget(row.manifest)} />
            ))}
          </>
        ) : null}
      </div>

      <div className="mt-2 border-t border-line pt-3">
        <p className="text-caption text-text-tertiary" title={t("WidgetLibrary", "ComingSoon")}>
          {t("WidgetLibrary", "StoreTeaser")}
        </p>
      </div>
    </aside>
  )
}
