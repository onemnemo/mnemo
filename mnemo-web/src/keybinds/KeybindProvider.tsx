import { type ReactNode, useEffect } from "react"

import { isModalOpen } from "@/lib/modal"

import { isEditableTarget, matchesEvent, parseChord } from "./chord"
import { fetchKeybinds } from "./api"
import { getKeybindHandler } from "./registry"
import { useKeybindStore } from "./store"

// Loads the keybind catalog and runs the global matcher for the session. Mounted
// once near the app root; renders children unchanged. Only Global-scope actions
// with a registered handler are dispatched here - Local (editor) actions are the
// active editor's concern. Actions flagged allowedDuringTextCapture still fire
// while a text field has focus (e.g. global search from an input).
export function KeybindProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let cancelled = false
    fetchKeybinds()
      .then((keybinds) => {
        if (!cancelled) useKeybindStore.getState().setKeybinds(keybinds)
      })
      .catch(() => {
        // No catalog: shortcuts are simply inactive this session.
      })

    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat) return
      // A dialog owns the keyboard while it is up. Navigating out from under one would unmount
      // whatever it was editing, and the text-capture gate below does not stop the shortcuts
      // that are allowed to run while typing.
      if (isModalOpen()) return
      const inTextCapture = isEditableTarget(event.target)

      for (const keybind of useKeybindStore.getState().keybinds) {
        if (keybind.scope !== "Global" || !keybind.enabled) continue
        if (inTextCapture && !keybind.allowedDuringTextCapture) continue
        const handler = getKeybindHandler(keybind.actionId)
        if (!handler) continue

        for (const binding of keybind.bindings) {
          if (binding.kind !== "Chord" || !binding.chord) continue
          if (matchesEvent(parseChord(binding.chord), event)) {
            event.preventDefault()
            handler()
            return
          }
        }
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      cancelled = true
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [])

  return <>{children}</>
}
