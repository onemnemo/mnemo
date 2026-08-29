// Prevent unhandled file and link drops from navigating away from the app.

/**
 * Whether the drop may navigate away. Link drops are blocked even in text fields; plain text
 * remains insertable.
 */
function leavesTheApp(transfer: DataTransfer | null): boolean {
  const types = transfer?.types
  // An empty transfer cannot establish a safe plain-text drop.
  if (!types || types.length === 0) return true
  return types.includes("Files") || types.includes("text/uri-list")
}

/**
 * Refuses a drop the engine would navigate on, anywhere in the window, for the life
 * of the returned disposer.
 */
export function installNativeDropGuard(): () => void {
  // Cancel dragover to receive drop, then cancel drop to prevent navigation.
  const claim = (event: DragEvent) => {
    if (!leavesTheApp(event.dataTransfer)) return
    event.preventDefault()
  }

  // Bubble after surface-specific drop handlers have run.
  window.addEventListener("dragover", claim)
  window.addEventListener("drop", claim)
  return () => {
    window.removeEventListener("dragover", claim)
    window.removeEventListener("drop", claim)
  }
}
