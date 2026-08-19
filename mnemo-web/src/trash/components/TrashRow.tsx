import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { formatRelative } from "@/lib/relative-date"

import { kindIcon, kindLabel } from "../kinds"
import { formatExpiresIn } from "../retention"
import type { TrashEntryDto } from "../types"
import { DestinationMenu } from "./DestinationMenu"

/**
 * One deleted thing, with everything needed to decide whether to keep it.
 *
 * The second line answers the question a list of titles cannot: what it was, where it came from,
 * how much came with it, and how long is left. A folder that took a subtree and an empty folder
 * look identical without it, and they are not the same thing to put back.
 */
export function TrashRow({
  entry,
  now,
  busy,
  needsDestination,
  onRestore,
  onPurge,
}: {
  entry: TrashEntryDto
  now: number
  busy: boolean
  /** Set once a restore answered that this entry has nowhere to go. */
  needsDestination: boolean
  onRestore: (destinationId?: string) => void
  onPurge: () => void
}) {
  const t = useT()

  // A build without the module that owns the kind can still show the row, so somebody can see
  // what is being kept and can throw it away, but it cannot put it back.
  const unavailable = !entry.sourceAvailable

  const details = [
    kindLabel(entry.kind, t),
    entry.origin ? t("Trash", "FromFormat", { 0: entry.origin }) : null,
    entry.containedCount > 0
      ? t("Trash", entry.containedCount === 1 ? "ContainedOne" : "ContainedManyFormat", { 0: entry.containedCount })
      : null,
    formatRelative(entry.deletedAt, now, t),
  ].filter(Boolean)

  return (
    <div className="group/trash flex items-center justify-between gap-6 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <AppIcon name={kindIcon(entry.kind)} size={16} strokeWidth={1.6} className="shrink-0 text-ink-icon" />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] text-ink">{entry.title}</p>
          <p className="mt-0.5 truncate text-[12px] text-ink-3">
            {details.join(" · ")}
            <span className="ml-1.5 text-ink-3">{formatExpiresIn(entry.expiresAt, now, t)}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {needsDestination && !unavailable ? (
          <DestinationMenu label={t("Trash", "RestoreInto")} disabled={busy} onChoose={(id) => onRestore(id)} />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || unavailable}
            title={unavailable ? t("Trash", "SourceUnavailable") : undefined}
            onClick={() => onRestore()}
            icon={<AppIcon name="rotate-ccw" size={13} strokeWidth={1.7} />}
          >
            {t("Trash", "Restore")}
          </Button>
        )}

        {/* Quiet until the row is hovered: destroying something for good is available on every
            row and invited by none of them. */}
        <Button
          variant="danger"
          size="sm"
          disabled={busy}
          aria-label={t("Trash", "DeleteForever")}
          title={t("Trash", "DeleteForever")}
          onClick={onPurge}
          className="opacity-0 transition-opacity group-hover/trash:opacity-100 focus-visible:opacity-100"
        >
          <AppIcon name="trash-2" size={14} strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  )
}
