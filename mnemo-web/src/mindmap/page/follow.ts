/**
 * Where a reference node goes when it is followed.
 *
 * A reference is the one node whose point is somewhere else, so opening it is the primary thing to
 * do with it rather than a thing on a menu. Three targets, three destinations: a link leaves the app
 * entirely, and a note or a deck is a route this window already knows how to be.
 */

import { navigate } from "@/app/router"
import { openExternally } from "@/lib/external"
import { isSafeUrl } from "@/notes/editor/schema/safe-url"

import type { ElementContent, FlashcardContent, LinkContent, NoteContent } from "../model/document"

/** True when this content has somewhere to go, which is what makes a double click follow it. */
export function isFollowable(content: ElementContent): boolean {
  switch (content.$type) {
    case "note":
    case "flashcard":
      return true
    case "link":
      return absoluteUrl((content as LinkContent).url) !== null
    default:
      return false
  }
}

/** Follows the reference, or does nothing when there is nothing to follow. */
export function followRef(content: ElementContent): void {
  switch (content.$type) {
    case "note":
      navigate("notes", (content as NoteContent).noteId)
      return
    case "flashcard":
      navigate("flashcard-deck", (content as FlashcardContent).deckId)
      return
    case "link": {
      const url = absoluteUrl((content as LinkContent).url)
      if (url) {
        openExternally(url)
      }
      return
    }
    default:
  }
}

/**
 * The address to hand the operating system, or null when it is not one to open.
 *
 * A scheme is added rather than demanded, because "mnemo.app" is what people type and a link node
 * that refused it would be a link node nobody could make. The scheme check is the same one the notes
 * editor gates its links with, so `javascript:` is no more openable from a map than from a document.
 */
function absoluteUrl(raw: string | undefined): string | null {
  const url = raw?.trim()
  if (!url || !isSafeUrl(url)) {
    return null
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
}
