import { useEffect, type RefObject } from "react"

import { useDialogStore } from "@/stores/dialog"

/**
 * Puts focus back in the editor after its confirm dialog closes. The dialog restores focus to an
 * element that can be gone by then, which leaves the body focused and every editor key dead.
 */
export function useRestoreFocus(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let last: HTMLElement | null = null
    const remember = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) last = event.target
    }
    const node = root.current
    node?.addEventListener("focusin", remember)

    let timer = 0
    const unsubscribe = useDialogStore.subscribe((state, previous) => {
      if (state.queue.length > 0 || previous.queue.length === 0) return
      // Later than the dialog's own focus restore, which runs on a zero delay timer.
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const current = root.current
        if (!current || useDialogStore.getState().queue.length > 0) return
        if (current.contains(document.activeElement)) return
        const target = last?.isConnected && current.contains(last) ? last : current
        target.focus()
      }, 50)
    })

    return () => {
      node?.removeEventListener("focusin", remember)
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [root])
}
