import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { TransferFormatDto } from "@/api/types"
import type { TransferScope } from "../store"
import { packageCaptionKey } from "../transfer"

/**
 * Display name and one-line caption per format. The adapters carry their own English names, but
 * these come from the translation bundle so an export dialog reads in the app's language.
 */
const FORMAT_KEYS: Record<string, { label: string; caption: string }> = {
  "flashcards.mnemo": { label: "TransferFormatArchive", caption: "" },
  "flashcards.csv": { label: "TransferFormatCsv", caption: "TransferFormatCaptionCsv" },
  "flashcards.anki": { label: "TransferFormatAnki", caption: "TransferFormatCaptionAnki" },
}

/**
 * The package format's caption depends on what the file would hold: the whole collection, which
 * is a backup and restores as one, or the decks the scope names, which is content to hand on.
 * The other formats say the same thing whatever the scope is.
 */
function captionKeyFor(formatId: string, scope: TransferScope): string {
  if (formatId === "flashcards.mnemo") return packageCaptionKey(scope.wholeCollection)
  return FORMAT_KEYS[formatId]?.caption ?? ""
}

/** The export side: which format to write, and a reminder of what is going into it. */
export function ExportPanel({
  formats,
  selected,
  scope,
  busy,
  onSelect,
}: {
  formats: TransferFormatDto[]
  selected: string | null
  scope: TransferScope
  busy: boolean
  onSelect: (formatId: string) => void
}) {
  const t = useT()
  const fc = (key: string) => t("Flashcards", key)
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
            const keys = FORMAT_KEYS[format.formatId]
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
                <span
                  className={cn(
                    "font-mono text-caption",
                    isSelected ? "text-brand" : "text-text-faded",
                  )}
                >
                  {format.extensions[0] ?? ""}
                </span>
                <span className="truncate text-body-extra-small font-semibold text-text-primary">
                  {keys ? common(keys.label) : format.displayName}
                </span>
                {keys ? (
                  <span className="text-caption leading-snug text-text-tertiary">
                    {common(captionKeyFor(format.formatId, scope))}
                  </span>
                ) : null}
                {isSelected ? (
                  <AppIcon
                    name="common/check-circle"
                    size={15}
                    className="absolute top-2 right-2 text-brand"
                  />
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
        {/* One scope, fixed by whichever entry point opened the dialog, so it reads as a
            statement rather than a choice the user is being asked to make again. */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-subtle px-2.5 py-2">
          <AppIcon name="common/book" size={14} className="shrink-0 text-text-faded" />
          <span className="min-w-0 flex-1 truncate text-body-extra-small text-text-primary">{scope.label}</span>
          <span className="shrink-0 font-mono text-caption text-text-faded">{scope.deckIds.length}</span>
        </div>
        {formats.length === 0 ? (
          <p className="text-caption text-[var(--toast-accent-warning)]">{fc("ExportFormatUnavailableMessage")}</p>
        ) : null}
      </div>
    </div>
  )
}
