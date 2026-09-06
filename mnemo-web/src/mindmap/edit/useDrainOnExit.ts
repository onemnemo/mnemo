/**
 * Holds the exit open until the map's writes have landed.
 *
 * Every gesture on the canvas sends its write and moves on, so at the moment the window closes there
 * is routinely one in the air: a drag that was let go of, a delete, an arrange, a paste. Nothing
 * waits for those, and the host closes the window the instant the handshake answers, so without this
 * step the edit is on screen, gone from the server, and nothing anywhere says so.
 */

import { useEffect, useRef } from "react"

import { onShutdown } from "@/app/shutdown"

import type { MindmapEditor } from "./useMindmapEditor"

export function useDrainOnExit(editor: MindmapEditor): void {
  // Read at exit rather than captured, because the editor is a fresh object on every render and an
  // effect that depended on it would re-register on every keystroke in the map.
  const current = useRef(editor)
  current.current = editor

  useEffect(() => onShutdown(() => current.current.drain()), [])
}
