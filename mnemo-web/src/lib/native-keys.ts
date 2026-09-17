// Block browser reload and print defaults without stopping app shortcuts. PhotinoX does not expose
// a native accelerator switch. Which presses those are is decided in keybinds/reserved.ts,
// where the Keyboard page reads the same rule before it stores a chord.

import { isReservedEvent } from "@/keybinds/reserved"

/**
 * Whether printing uses the macOS Cmd modifier.
 */
function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
}

function isEngineAccelerator(event: KeyboardEvent): boolean {
  return isReservedEvent(event, isApplePlatform())
}

const refused = new WeakSet<KeyboardEvent>()

/**
 * Whether this guard is the reason an event is already `defaultPrevented`.
 *
 * An app handler on the same chord has to tell the two apart: a press the guard
 * refused is still unclaimed and is the handler's to answer, while one prevented
 * by anything else was answered before it arrived.
 */
export function isNativeKeyRefusal(event: KeyboardEvent): boolean {
  return refused.has(event)
}

/**
 * Refuses the engine's reload and print accelerators for the life of the returned
 * disposer. Only their default is prevented; the keymap declines a prevented press, so
 * an app binding on the same chord runs only from a handler of its own that asks
 * `isNativeKeyRefusal` first, and the Keyboard page refuses to record one.
 */
export function installNativeKeyGuard(): () => void {
  // Block repeated presses and presses while dialogs are open as well.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isEngineAccelerator(event)) return
    refused.add(event)
    event.preventDefault()
  }

  // Capture before descendant handlers can stop propagation.
  window.addEventListener("keydown", onKeyDown, true)
  return () => window.removeEventListener("keydown", onKeyDown, true)
}
