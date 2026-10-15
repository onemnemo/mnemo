import { useEffect, useRef, useState } from "react"

/** A still pointer repeats dragover about every 350 ms. */
const HIDE_AFTER_MS = 400

/** Files being dragged over the window, and the drop once they land. */
export function useFileDrop(enabled: boolean, locked: boolean, onDrop: (data: DataTransfer) => void): boolean {
  return useFileDropCount(enabled, locked, onDrop) !== null
}

/** The same drag with its item count. null when nothing is dragged. 0 when the platform only reports the count on drop. */
export function useFileDropCount(
  enabled: boolean,
  locked: boolean,
  onDrop: (data: DataTransfer) => void,
): number | null {
  const [over, setOver] = useState<number | null>(null)
  const latest = useRef({ locked, onDrop })
  latest.current = { locked, onDrop }

  useEffect(() => {
    if (!enabled) return
    let timer = 0
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") === true

    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = latest.current.locked ? "none" : "copy"
      if (latest.current.locked) return
      setOver(Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === "file").length)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setOver(null), HIDE_AFTER_MS)
    }
    const onDropped = (event: DragEvent) => {
      if (!carriesFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      window.clearTimeout(timer)
      setOver(null)
      if (!latest.current.locked) latest.current.onDrop(event.dataTransfer)
    }

    document.addEventListener("dragover", onDragOver)
    document.addEventListener("drop", onDropped)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("drop", onDropped)
      setOver(null)
    }
  }, [enabled])

  return over
}
