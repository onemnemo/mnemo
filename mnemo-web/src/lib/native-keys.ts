// Block browser reload and print defaults without stopping app shortcuts. PhotinoX does not expose
// a native accelerator switch.

/**
 * Whether printing uses the macOS Cmd modifier.
 */
function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

function isEngineAccelerator(event: KeyboardEvent): boolean {
  // Block F5 reloads with any modifier combination.
  if (event.code === "F5" || event.key === "F5") return true
  if (event.altKey) return false
  if (!event.ctrlKey && !event.metaKey) return false

  // Engines match a letter accelerator by the character on some keyboard layouts
  // and by the physical key on others, so both readings are claimed.
  const key = event.key.toLowerCase()
  if (event.code === "KeyR" || key === "r") return true

  if (event.shiftKey) return false
  if (event.code !== "KeyP" && key !== "p") return false
  // Preserve macOS Ctrl+P text navigation; printing uses Cmd+P.
  return isApplePlatform() ? event.metaKey : event.ctrlKey
}

/**
 * Refuses the engine's reload and print accelerators for the life of the returned
 * disposer. Only their default is prevented, so an app binding on the same chord
 * still runs.
 */
export function installNativeKeyGuard(): () => void {
  // Block repeated presses and presses while dialogs are open as well.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isEngineAccelerator(event)) return
    event.preventDefault()
  }

  // Capture before descendant handlers can stop propagation.
  window.addEventListener("keydown", onKeyDown, true)
  return () => window.removeEventListener("keydown", onKeyDown, true)
}
