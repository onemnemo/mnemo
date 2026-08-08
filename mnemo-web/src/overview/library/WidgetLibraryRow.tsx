import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import type { WidgetManifest } from "../widgets/manifest"

export interface LibraryRowModel {
  manifest: WidgetManifest
  title: string
  /** The gallery description when the widget has one, otherwise the short description. */
  description: string
  /** Supported sizes joined with " · ", e.g. "2×1 · 2×2". */
  sizesText: string
  /** "by @author", extensions only. */
  bylineText: string
  /** "" for none, "On grid" for one, "On grid ×n" for more. */
  onGridText: string
  isExtension: boolean
}

interface WidgetLibraryRowProps {
  model: LibraryRowModel
  onAdd: () => void
}

/**
 * Icons that paint white lines over a currentColor fill (a knockout). The registry rewrites every
 * non-currentColor to currentColor, which would collapse those lines into the fill and leave a solid
 * blob, so these render with their own colors kept. This is the widget icon's only call site.
 */
const KNOCKOUT_ICONS = new Set(["widgets/recent-decks", "widgets/recent-notes"])

/**
 * One widget in the library: an icon tile, the title and metadata, and an Add button.
 *
 * The description is a real line here, which the desktop's row never renders. The strings exist and
 * are translated, and a picker with no descriptions is a worse surface, so the port shows one. That
 * is a deliberate, visible divergence from the desktop.
 */
export function WidgetLibraryRow({ model, onAdd }: WidgetLibraryRowProps) {
  const t = useT()
  const { manifest } = model

  return (
    <div className="mb-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5 rounded-lg p-2">
      <div className="grid size-10 place-items-center rounded-md bg-[var(--accent-subtle-background)] text-brand">
        <AppIcon name={manifest.icon} size={20} preserveColors={KNOCKOUT_ICONS.has(manifest.icon)} />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-body-small font-semibold text-text-primary">{model.title}</span>
          {model.isExtension ? (
            <span className="shrink-0 rounded-sm bg-surface-subtle px-1 text-micro font-semibold text-text-tertiary">
              EXT
            </span>
          ) : null}
        </div>

        {model.description ? (
          <span className="truncate text-caption text-text-tertiary">{model.description}</span>
        ) : null}

        <div className="flex min-w-0 items-center gap-1.5 text-caption">
          <span className="shrink-0 font-mono text-text-tertiary">{model.sizesText}</span>
          {model.isExtension && model.bylineText ? (
            <span className="truncate text-text-tertiary">{model.bylineText}</span>
          ) : null}
          {model.onGridText ? <span className="shrink-0 text-brand">{model.onGridText}</span> : null}
        </div>
      </div>

      <Button variant="outline" size="sm" className="shrink-0 px-3" onClick={onAdd}>
        {t("WidgetLibrary", "Add")}
      </Button>
    </div>
  )
}
