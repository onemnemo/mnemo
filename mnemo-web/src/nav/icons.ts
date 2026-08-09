import type { NavItemModel } from "./types"

/**
 * The glyph each module shows in the rail.
 *
 * Keyed by route rather than by the icon the server sends, because that string is
 * a desktop resource path: an implementation detail of the other frontend, not a
 * design decision this one should inherit. Which mark stands for Notes belongs
 * with the rest of the visual vocabulary, here.
 *
 * Anything unlisted keeps the art the module registered, so a module that ships
 * its own SVG still renders without being named here.
 *
 * The set reads as what you do in a module rather than what it contains: a house
 * for the place you start, an orbit for something travelling alongside you.
 */
const NAV_ICONS: Record<string, string> = {
  overview: "house",
  soma: "orbit",
  notes: "notebook-text",
  flashcards: "square-stack",
  mindmap: "network",
  settings: "settings",
}

export function navIcon(item: NavItemModel): string {
  return NAV_ICONS[item.route] ?? item.icon
}
