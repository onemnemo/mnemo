/**
 * What an empty image is waiting on: nothing, an upload in flight, or an upload that failed.
 *
 * Held outside the document because none of it is saved, and outside the route's state because the
 * node that shows it is memoized per element and only re-renders for its own id. Keyed by map as well
 * as element, and pruned as elements go, so nothing shows on a map or an element it was not about.
 */

import { createContext, useContext, useSyncExternalStore } from "react"

export type ImageSlotState = "idle" | "uploading" | "failed"

const states = new Map<string, ImageSlotState>()
const listeners = new Set<() => void>()

const keyOf = (mapId: string, id: string): string => `${mapId}\n${id}`

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function setImageSlot(mapId: string, id: string, state: ImageSlotState): void {
  const key = keyOf(mapId, id)
  if ((states.get(key) ?? "idle") === state) {
    return
  }
  if (state === "idle") {
    states.delete(key)
  } else {
    states.set(key, state)
  }
  notify()
}

export function imageSlotOf(mapId: string, id: string): ImageSlotState {
  return states.get(keyOf(mapId, id)) ?? "idle"
}

/** Forgets every state this map holds for an element `keep` turns down. */
export function pruneImageSlots(mapId: string, keep: (id: string) => boolean): void {
  const prefix = keyOf(mapId, "")
  let changed = false
  for (const key of [...states.keys()]) {
    if (key.startsWith(prefix) && !keep(key.slice(prefix.length))) {
      states.delete(key)
      changed = true
    }
  }
  if (changed) {
    notify()
  }
}

/** The map the canvas below is showing, which is what a node's slot state is read under. */
export const ImageSlotMap = createContext("")

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useImageSlot(id: string): ImageSlotState {
  const mapId = useContext(ImageSlotMap)
  return useSyncExternalStore(subscribe, () => imageSlotOf(mapId, id))
}
