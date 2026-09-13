import { useCallback, useRef } from "react"

import { dialog, type ConfirmOptions } from "@/stores/dialog"

interface DiscardGuardOptions {
  isDirty: () => boolean
  onClose: () => void
  confirmation: ConfirmOptions
}

/**
 * The single funnel every dismiss path goes through: Escape, a backdrop or outside click, the
 * header close button, and a footer Close or Cancel button all end up here. Edits that have not
 * been saved are confirmed rather than silently dropped, and a second gesture while the question
 * is up is ignored rather than asked twice.
 */
export function useDiscardGuard(options: DiscardGuardOptions): () => Promise<void> {
  const latest = useRef(options)
  latest.current = options
  const pending = useRef(false)

  return useCallback(async () => {
    if (pending.current) return
    pending.current = true
    try {
      const current = latest.current
      if (current.isDirty() && !(await dialog.confirm(current.confirmation))) return
      latest.current.onClose()
    } finally {
      pending.current = false
    }
  }, [])
}
