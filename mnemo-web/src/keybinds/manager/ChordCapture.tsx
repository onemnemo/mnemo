import { useEffect, useRef, useState } from "react"

import { useT } from "@/i18n/useT"

import { chordFromEvent, formatChord } from "../chord"

/**
 * Listens for the next key combination and reports it as a canonical chord.
 *
 * Captures at the field rather than the window so the app's own shortcuts do not fire
 * while the user is pressing the one they want to bind. Escape cancels, which is why
 * it is filtered out rather than captured.
 */
export function ChordCapture({
  onChord,
  onCancel,
}: {
  onChord: (chord: string) => void
  onCancel: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => ref.current?.focus(), [])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="textbox"
      aria-label={t("Keybinds", "keybindManager.editorPressShortcut")}
      onBlur={onCancel}
      onKeyDown={(e) => {
        e.preventDefault()
        e.stopPropagation()

        if (e.key === "Escape") {
          onCancel()
          return
        }

        // Modifier-only presses just update the preview; the chord lands on a real key.
        const chord = chordFromEvent(e.nativeEvent)
        if (!chord) {
          setPreview(null)
          return
        }

        setPreview(chord)
        onChord(chord)
      }}
      className="rounded-sm border-2 border-brand bg-surface-subtle px-2 py-1 text-micro text-text-primary outline-none"
    >
      {preview ? formatChord(preview) : t("Keybinds", "keybindManager.editorWaiting")}
    </div>
  )
}
