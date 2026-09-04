/**
 * Who owns the Escape key while the peek is open.
 *
 * The peek listens on the document, so it sees Escape before deciding anything, and
 * almost every other Escape in the app is somebody else's. ProseMirror answers most of
 * them and marks the event handled, but a caret sitting in prose with no selection and
 * no find bar open is a case it deliberately leaves alone: the key arrives here
 * unhandled from an editor that is still very much in use. Closing on it would make
 * the peek steal Escape from the note the reader is writing, so focus decides.
 */

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "password", "tel", "number"])

/** True for anything a caret can sit in. An `contenteditable="false"` island is not one. */
export function isEditableElement(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node instanceof HTMLTextAreaElement) return true
  if (node instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(node.type)
  const editable = node.closest("[contenteditable]")
  return editable !== null && editable.getAttribute("contenteditable") !== "false"
}

export interface EscapeContext {
  /** Somebody ahead of the peek already answered the key. */
  readonly defaultPrevented: boolean
  /** A menu or a dialog is on screen and Escape belongs to it. */
  readonly overlayOpen: boolean
  /** Focus is in a field or a live editor, wherever that field happens to be. */
  readonly focusIsEditable: boolean
  /** The peek is an unpinned overlay, the only shape Escape may close. */
  readonly closable: boolean
}

/**
 * A field inside the panel is as much a field as one outside it. The assistant's composer
 * holds its draft in component state and answers only Enter, so closing the panel on that
 * press would unmount the draft rather than dismiss anything. The read-only document the
 * panel usually shows is `contenteditable="false"` and so is not a field, which is why
 * Escape still closes a peeked note with the caret sitting in it.
 */
export function escapeShouldClosePeek(context: EscapeContext): boolean {
  if (context.defaultPrevented || context.overlayOpen || !context.closable) return false
  return !context.focusIsEditable
}

/** Reads the context off a real keydown, so the rule above stays testable on its own. */
export function escapeContextOf(event: KeyboardEvent, closable: boolean): EscapeContext {
  const target = event.target
  return {
    defaultPrevented: event.defaultPrevented,
    overlayOpen: document.querySelector('[role="menu"], [role="dialog"]') !== null,
    // The event's own target as well as the focused element: they agree for a real
    // keystroke, and the target is the half a test can state directly.
    focusIsEditable:
      isEditableElement(target instanceof Element ? target : null) ||
      isEditableElement(document.activeElement),
    closable,
  }
}
