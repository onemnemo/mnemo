import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { TransferFormatDto } from "@/api/types"
import type { NoteTransferScope } from "../store"

/** The export side: which format to write, and a reminder of what is going into it. */
export function NoteExportPanel({
  formats,
  selected,
  scope,
  busy,
  onSelect,
}: {
  formats: TransferFormatDto[]
  selected: string | null
  scope: NoteTransferScope
  busy: boolean
  onSelect: (formatId: string) => void
}) {
  const t = useT()
  const nt = (key: string) => t("Notes", key)
  const common = (key: string) => t("Common", key)

  return (
    <div className="space-y-[18px]">
      <div className="space-y-2">
        <span className="block text-body-extra-small font-semibold text-text-secondary">
          {common("TransferFormatLabel")}
        </span>
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
                  "relative flex min-w-0 flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors",
                  "disabled:pointer-events-none disabled:opacity-50",
                  isSelected ? "border-brand bg-brand-subtle" : "border-line hover:border-text-faded",
                )}
              >
                <span className={cn("font-mono text-caption", isSelected ? "text-brand" : "text-text-faded")}>
                  {format.extensions[0] ?? ""}
                </span>
                <span className="truncate text-body-extra-small font-semibold text-text-primary">
                  {format.displayName}
                </span>
                {isSelected ? (
                  <AppIcon name="common/check-circle" size={15} className="absolute top-2 right-2 text-brand" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <span className="block text-body-extra-small font-semibold text-text-secondary">
          {common("TransferScopeLabel")}
        </span>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-subtle px-2.5 py-2">
          <AppIcon name="common/file-text" size={14} className="shrink-0 text-text-faded" />
          <span className="min-w-0 flex-1 truncate text-body-extra-small text-text-primary">{scope.label}</span>
          <span className="shrink-0 font-mono text-caption text-text-faded">{scope.noteIds.length}</span>
        </div>
        {formats.length === 0 ? (
          <p className="text-caption text-[var(--toast-accent-warning)]">{nt("ExportFormatUnavailableMessage")}</p>
        ) : null}
      </div>
    </div>
  )
}
