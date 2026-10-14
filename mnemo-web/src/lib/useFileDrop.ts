import { useEffect, useRef, useState } from "react"

/** A still pointer repeats dragover about every 350 ms. */
const HIDE_AFTER_MS = 400

/** Files being dragged over the window, and the drop once they land. */
export function useFileDrop(enabled: boolean, locked: boolean, onDrop: (data: DataTransfer) => void): boolean {
  const [over, setOver] = useState(false)
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
      setOver(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setOver(false), HIDE_AFTER_MS)
    }
    const onDropped = (event: DragEvent) => {
      if (!carriesFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      window.clearTimeout(timer)
      setOver(false)
      if (!latest.current.locked) latest.current.onDrop(event.dataTransfer)
    }

    document.addEventListener("dragover", onDragOver)
    document.addEventListener("drop", onDropped)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("dragover", onDragOver)
      document.removeEventListener("drop", onDropped)
      setOver(false)
    }
  }, [enabled])

  return over
}
