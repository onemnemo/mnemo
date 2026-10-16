import { useCallback, useEffect, useState } from "react"

import { describeError } from "@/api/error-copy"
import type { ConflictPolicy } from "@/api/types"
import { useT } from "@/i18n/useT"
import { toast } from "@/stores/toast"

/** The duplicate-name choice. `onEdit` goes to the import queue so a replace is asked for again after any edit. */
export function useConflictChoice() {
  const [conflict, setConflict] = useState<ConflictPolicy>("KeepBoth")
  const onEdit = useCallback(() => setConflict((policy) => (policy === "Replace" ? "KeepBoth" : policy)), [])
  return { conflict, setConflict, onEdit }
}

/** Forgets the choice once nothing collides, because it was made for an earlier queue. */
export function useResetConflict(collisions: number, setConflict: (policy: ConflictPolicy) => void) {
  useEffect(() => {
    if (collisions === 0) setConflict("KeepBoth")
  }, [collisions, setConflict])
}

/** The export format picked in the dialog. Defaults to the first one offered and corrects a pick that is no longer offered. */
export function useExportFormat(available: readonly { formatId: string }[]) {
  const [format, setFormat] = useState<string | null>(null)
  useEffect(() => {
    if (available.length === 0) return
    setFormat((current) =>
      current && available.some((option) => option.formatId === current) ? current : available[0].formatId,
    )
  }, [available])
  return [format, setFormat] as const
}

/** Says out loud that the format list failed to load, so the dialog does not silently refuse every file. */
export function useFormatsErrorToast(query: { isError: boolean; error: unknown }) {
  const t = useT()
  useEffect(() => {
    if (query.isError) {
      toast.warning(t("Common", "ImportFailedTitle"), { description: describeError(t, query.error) })
    }
    // Keyed on the failure alone so a new `t` does not repeat the toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.isError])
}

/** "1 note" or "3 notes", with the noun taken from the module's translations. */
export function useItemPhrase(module: "Notes" | "Flashcards" | "Mindmap") {
  const t = useT()
  return (count: number) => {
    const noun = t(module, count === 1 ? "TransferNounSingular" : "TransferNounPlural")
    return count === 1
      ? t("Common", "TransferOneItemFormat", { 0: noun })
      : t("Common", "TransferManyItemsFormat", { 0: count, 1: noun })
  }
}
