import { openExternally } from "@/lib/external"

import { openNoteInPeek } from "./store"

/**
 * What happens when a link inside the peek's note is activated.
 *
 * The block editor renders links and page references as real anchors and relies on the
 * browser refusing to follow a link inside a `contenteditable` (the page reference view
 * says so in as many words, and sets its route by hand for that reason). A read-only
 * mount is `contenteditable="false"`, so that protection is gone: an ordinary anchor
 * click would navigate the whole window, and the shipped window is chromeless, so it
 * would replace the application with a web page and leave no way back.
 *
 * So activation is intercepted and re-decided here. Nothing on this path ever assigns
 * `window.location`.
 *
 *  - A note inside the app opens in the peek, which is the panel's whole promise: go and
 *    look at the thing and still be where you were.
 *  - An external address goes to the operating system's browser through the host.
 *  - Anything else does nothing. An in-app route with no reader in the panel would have
 *    to throw away the canvas the reader is comparing against, and that is the one thing
 *    a panel called "don't lose my place" may not do.
 */
export type PeekLinkAction =
  | { readonly kind: "note"; readonly id: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "none" }

const NOTE_ROUTE = /^#\/?notes\/([^/?#]+)/
const EXTERNAL_SCHEME = /^https?:/i

export function peekLinkAction(href: string): PeekLinkAction {
  const value = href.trim()
  if (value === "") return { kind: "none" }

  const note = NOTE_ROUTE.exec(value)
  if (note) return { kind: "note", id: decodeURIComponent(note[1]) }
  if (value.startsWith("#")) return { kind: "none" }
  if (EXTERNAL_SCHEME.test(value)) return { kind: "external", url: value }

  // mailto and tel reach the anchor as safe schemes, and the host opens http and https
  // only, so there is nothing to hand them to. Everything else the safety gate already
  // stripped of its href before it got here.
  return { kind: "none" }
}

export function runPeekLinkAction(action: PeekLinkAction): void {
  if (action.kind === "note") openNoteInPeek(action.id)
  else if (action.kind === "external") openExternally(action.url)
}

/**
 * Delegated on the panel's document root, in the capture phase, so it decides before the
 * page reference view's own click and key handlers get to route the canvas away. Both of
 * those surfaces are anchors carrying the note's route in their `href`, so one rule
 * covers a link the user typed and a page card the editor drew.
 */
export function installPeekLinkGuard(root: HTMLElement): () => void {
  const activate = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest("a[href]")
    if (!anchor || !root.contains(anchor)) return

    event.preventDefault()
    event.stopPropagation()
    runPeekLinkAction(peekLinkAction(anchor.getAttribute("href") ?? ""))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return
    activate(event)
  }

  root.addEventListener("click", activate, true)
  root.addEventListener("keydown", onKeyDown, true)
  return () => {
    root.removeEventListener("click", activate, true)
    root.removeEventListener("keydown", onKeyDown, true)
  }
}
