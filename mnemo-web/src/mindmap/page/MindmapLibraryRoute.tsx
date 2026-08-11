import { useMemo } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { navigate } from "@/app/router"

import { useCreateMindmap, useMindmapLibrary, useMindmapTemplates } from "../api"
import { MindmapThumbnail } from "./MindmapThumbnail"

/**
 * The gallery.
 *
 * Each card draws the map it stands for rather than a generic tile, which is why the library endpoint
 * serves whole documents and not headers: a mindmap is recognised by its shape long before its title
 * is read, and a wall of identical rectangles makes a user open three maps to find one.
 */
export function MindmapLibraryRoute() {
  const t = useT()
  const library = useMindmapLibrary()
  const templates = useMindmapTemplates()
  const create = useCreateMindmap()

  const entries = useMemo(
    () =>
      [...(library.data ?? [])].sort((a, b) =>
        (b.document.modifiedAt ?? "").localeCompare(a.document.modifiedAt ?? ""),
      ),
    [library.data],
  )

  function onCreate() {
    create.mutate(
      { title: t("Mindmap", "NewMindmap") },
      { onSuccess: (document) => navigate("mindmap", document.id) },
    )
  }

  return (
    <div className="min-h-full bg-canvas-sunken">
      <div className="mx-auto flex max-w-[1232px] flex-col gap-6 px-6 pb-20 pt-7">
        <header className="flex items-center gap-3">
          <h1 className="text-[19px] font-semibold tracking-[-0.01em] text-ink">{t("Mindmap", "Title")}</h1>
          <Button
            className="ml-auto"
            onClick={onCreate}
            disabled={create.isPending}
            icon={<AppIcon name="plus" size={14} strokeWidth={2} />}
          >
            {t("Mindmap", "NewMap")}
          </Button>
        </header>

        {library.isLoading ? (
          <p className="py-16 text-center text-[13px] text-ink-3">{t("Mindmap", "Loading")}</p>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line py-20">
            <AppIcon name="common/sitemap" size={24} className="text-ink-icon" />
            <p className="text-[14px] font-medium text-ink">{t("Mindmap", "LibraryEmptyTitle")}</p>
            <Button variant="outline" onClick={onCreate}>
              {t("Mindmap", "NewMap")}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-4">
            {entries.map((entry) => (
              <li key={entry.document.id}>
                <button
                  type="button"
                  onClick={() => navigate("mindmap", entry.document.id)}
                  className="group block w-full overflow-hidden rounded-xl bg-canvas text-left shadow-[0_0_0_1px_var(--line-soft)] transition-shadow hover:shadow-[0_0_0_1px_var(--line),0_2px_8px_-4px_oklch(0_0_0/0.12)]"
                >
                  <MindmapThumbnail
                    document={entry.document}
                    templates={templates.data?.templates ?? []}
                    defaultTemplateId={templates.data?.defaultId ?? ""}
                  />
                  <div className="px-3 py-2.5">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {entry.document.title || t("Mindmap", "UntitledMap")}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-3">
                      {t("Mindmap", "NodeCountFormat").replace(
                        "{0}",
                        String(entry.document.elements?.length ?? 0),
                      )}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
