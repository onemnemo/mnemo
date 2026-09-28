import { useState } from "react"

/**
 * Which panel is open, closed whenever the selection it was opened for changes. Reset during render
 * rather than in an effect, so it is already shut on the render that shows the new selection.
 */
export function usePanel<K extends string>(selectionKey: string) {
  const [open, setOpen] = useState<K | null>(null)
  const [seen, setSeen] = useState(selectionKey)
  if (seen !== selectionKey) {
    setSeen(selectionKey)
    setOpen(null)
  }
  return {
    open: seen === selectionKey ? open : null,
    toggle: (panel: K) => setOpen(open === panel ? null : panel),
    close: () => setOpen(null),
  }
}
