import { Z_LAYERS } from "@/lib/z-layers"

let layer: HTMLDivElement | null = null

/**
 * Shared portal above onboarding, modals, and the command palette. The unsized container does not
 * intercept pointer events outside its positioned children.
 */
export function getTopLayer(): HTMLDivElement {
  if (layer) return layer
  const node = document.createElement("div")
  node.style.position = "relative"
  node.style.zIndex = String(Z_LAYERS.dialog)
  document.body.appendChild(node)
  layer = node
  return layer
}
