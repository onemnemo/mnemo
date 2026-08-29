/**
 * Warns before reload when work is unsaved. The synchronous event cannot save data. Unmounting the
 * app removes this guard so crash recovery can reload.
 */

import { isAnythingDirty } from "./shutdown"

export function installUnloadBackstop(): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!isAnythingDirty()) return
    event.preventDefault()
    // Older Chromium raised the dialog for a returnValue rather than for a
    // cancelled event, and the window runs whatever runtime the machine has.
    event.returnValue = true
  }

  window.addEventListener("beforeunload", onBeforeUnload)
  return () => window.removeEventListener("beforeunload", onBeforeUnload)
}
