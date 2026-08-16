import type { TransferFormatDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { MindmapTransferScope } from "../store"

/** The export side: which format to write, and a reminder of what is going into it. */
export function MindmapExportPanel({
  formats,
  selected,
  scope,
  busy,
  onSelect,
}: {
  formats: TransferFormatDto[]
  selected: string | null
  scope: MindmapTransferScope
  busy: boolean
  onSelect: (formatId: string) => void
}) {
  const t = useT()
  const mm = (key: string) => t("Mindmap", key)
  const common = (key: string) => t("Common", key)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-ink-2">{common("TransferFormatLabel")}</span>
        {/* A grid rather than a row even while `.mnemo` is the only format: the tile still says what
            file is coming, and a second format widens the grid instead of rewriting this. */}
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, formats.length)}, minmax(0, 1fr))` }}
        >
          {formats.map((format) => {
            const isSelected = format.formatId === selected
            return (
              <button
                key={format.formatId}
                type="button"
                disabled={busy}
                aria-pressed={isSelected}
                onClick={() => onSelect(format.formatId)}
                className={cn(
                  "relative flex min-w-0 flex-col items-start gap-1 rounded-xl p-2.5 text-left transition-shadow",
                  "disabled:pointer-events-none disabled:opacity-50",
                  isSelected
                    ? "bg-accent-wash shadow-[0_0_0_1.5px_var(--accent)]"
                    : "shadow-[0_0_0_1px_var(--line-soft)] hover:shadow-[0_0_0_1px_var(--line)]",
                )}
              >
                <span className={cn("font-mono text-[10.5px]", isSelected ? "text-accent" : "text-ink-3")}>
                  {format.extensions[0] ?? ""}
                </span>
                <span className="truncate text-[12.5px] font-semibold text-ink">{format.displayName}</span>
                {isSelected ? (
                  <AppIcon name="common/check-circle" size={15} className="absolute right-2 top-2 text-accent" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold text-ink-2">{common("TransferScopeLabel")}</span>
        <div className="flex items-center gap-2 rounded-xl bg-canvas-sunken px-2.5 py-2">
          <AppIcon name="common/sitemap" size={14} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{scope.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">{scope.mapIds.length}</span>
        </div>
        {formats.length === 0 ? (
          <p className="text-[11.5px] text-danger">{mm("ExportFormatUnavailableMessage")}</p>
        ) : null}
      </div>
    </div>
  )
}
