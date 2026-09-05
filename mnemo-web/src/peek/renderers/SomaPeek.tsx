import { useEffect } from "react"

import { SomaDockBody } from "@/chat/components/SomaDockBody"
import { useAiEnabled } from "@/settings/aiEnabled"

import { usePeekStore } from "../store"

/**
 * Soma in the peek.
 *
 * The same conversation the dock and the full page show, which is why the two panels
 * are mutually exclusive: one conversation with two composers is a way to lose half of
 * what was typed. Turning the assistant off hides it here as it does everywhere else,
 * rather than leaving a disabled shell of it behind.
 */
export function SomaPeek() {
  const enabled = useAiEnabled()

  useEffect(() => {
    if (!enabled) usePeekStore.getState().closePeek()
  }, [enabled])

  if (!enabled) return null
  return <SomaDockBody />
}
