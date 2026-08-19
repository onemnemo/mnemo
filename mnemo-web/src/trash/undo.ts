import { useCallback } from "react"

import { useT } from "@/i18n/useT"
import { toast } from "@/stores/toast"

import { restoreBatch, useTrashInvalidator } from "./api"
import { retentionDays } from "./retention"
import type { TrashActionDto } from "./types"

/**
 * Raises the toast that follows a delete, and puts everything back if it is taken up.
 *
 * This is why the delete surfaces no longer ask first. A confirmation makes somebody defend a
 * decision before they can see its result, on every delete, including the overwhelming majority
 * that were meant; undo asks nothing and is only paid for by the rare delete that was a mistake.
 * It is honest here because the delete really is reversible: the batch id covers everything one
 * action took, so a folder comes back with its contents still inside it.
 *
 * One presenter for every module. A note, a mindmap and a deck have nothing in common except
 * that all three answer their delete with the same action, and the toast is built from that
 * alone, so a module added later gets its undo without writing any of this again.
 */
export function useUndoDelete() {
  const t = useT()
  const invalidate = useTrashInvalidator()

  return useCallback(
    (action: TrashActionDto) => {
      const [first, ...rest] = action.entries
      // Nothing was taken, so there is nothing to offer back. A delete that reached no content
      // is the source's business to report, not a toast reading "0 items".
      if (!first) return

      // The count moved even though nobody is looking at the trash, and the badge is on a page
      // one click away.
      invalidate()

      const undo = async () => {
        try {
          const result = await restoreBatch(action.batchId)
          invalidate()
          // Undo restores a batch that was live moments ago, so a pending entry means something
          // changed underneath it. Rare, and worth saying rather than leaving the row missing.
          if (result.pendingCount > 0) toast.warning(t("Trash", "UndoIncomplete"))
        } catch {
          toast.warning(t("Trash", "UndoFailed"))
        }
      }

      const days = retentionDays(first)
      toast.action(
        rest.length === 0
          ? t("Trash", "DeletedOneFormat", { 0: first.title })
          : t("Trash", "DeletedManyFormat", { 0: action.entries.length }),
        {
          description: t("Trash", days === 1 ? "KeptForDay" : "KeptForDays", { 0: days }),
          // Longer than the default: the whole point is that it can be read and answered, and
          // five seconds is not long enough to notice a mistake in what was just deleted.
          durationMs: 9000,
          primary: { label: t("Trash", "Undo"), onClick: () => void undo() },
        },
      )
    },
    [t, invalidate],
  )
}
