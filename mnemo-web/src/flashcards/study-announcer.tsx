import { useCallback, useState } from "react"

// The review, cram and test screens all swap their central content silently: the
// answer appears, or the whole card is replaced by the next one, with nothing else
// on screen to say so. A sighted reader sees it happen; a screen reader user gets
// no signal unless something here speaks it.

/** The live region's text, plus the setter that makes a repeat speak again. */
export function useStudyAnnouncer(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState("")

  const announce = useCallback((next: string) => {
    // Re-set even to the same text so a repeated announcement still speaks: a
    // trailing space forces a new string the screen reader treats as fresh.
    setMessage((prev) => (prev === next ? `${next} ` : next))
  }, [])

  return { message, announce }
}

/** Off-screen live region for {@link useStudyAnnouncer}'s message. */
export function StudyAnnouncer({ message }: { message: string }) {
  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  )
}
