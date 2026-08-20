import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { PackageEvidenceDto } from "@/api/types"
import { evidenceHeadline, evidenceLines, flashcardEvidence } from "../transfer"

/**
 * What a package would do, shown before anything is written: what kind of file it is, which
 * collection made it, how much of it is already here, what is here that it does not carry, and
 * what replacing would destroy.
 */
export function PackageEvidenceNote({ evidence }: { evidence: PackageEvidenceDto }) {
  const t = useT()
  const payload = flashcardEvidence(evidence)
  const unreadable = payload !== null && !payload.canRead
  const lines = evidenceLines(t, evidence)

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-2.5 py-2",
        unreadable
          ? "border-[var(--toast-accent-warning)] bg-[var(--toast-icon-badge-warning)]"
          : "border-line bg-surface-subtle",
      )}
    >
      <AppIcon
        name={unreadable ? "common/triangle-alert" : "info"}
        size={15}
        className={cn("mt-px shrink-0", unreadable ? "text-[var(--toast-accent-warning)]" : "text-text-faded")}
      />
      <div className="min-w-0 flex-1">
        <div className="text-body-extra-small font-medium text-text-primary">
          {evidenceHeadline(t, evidence)}
        </div>
        {lines.map((line) => (
          <div key={line} className="text-caption text-text-tertiary">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}
