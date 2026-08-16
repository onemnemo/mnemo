import type { KeybindHandler } from "./types"

// What each action does. Handlers are registered imperatively by the feature that
// owns the behavior (e.g. App registers global.assistant -> navigate to Atlas), so
// the keymap transport stays decoupled from what any action actually does. An
// action with no handler simply does not fire - useful while its target is still
// being built.
const handlers = new Map<string, KeybindHandler>()

/** Registers a handler for an action id. Returns a disposer that removes it. */
export function registerKeybindAction(actionId: string, handler: KeybindHandler): () => void {
  handlers.set(actionId, handler)
  return () => {
    if (handlers.get(actionId) === handler) handlers.delete(actionId)
  }
}

export function getKeybindHandler(actionId: string): KeybindHandler | undefined {
  return handlers.get(actionId)
}
