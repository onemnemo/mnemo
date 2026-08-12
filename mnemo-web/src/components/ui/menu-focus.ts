/**
 * Closing a menu normally hands focus back to its trigger. An item that puts a caret on
 * screen, a dialog or an inline editor, needs that suppressed: the restore lands a moment
 * after the field already has the caret and takes it straight back out again.
 *
 * Suppressing it for the whole menu costs a keyboard user their place on every other
 * close, including Escape, so a menu whose items differ passes a predicate instead and is
 * asked once the chosen item has run.
 */
export type OpensDialog = boolean | (() => boolean)

/** The `onCloseAutoFocus` handler for `opensDialog`, or nothing when focus should return. */
export function closeFocusHandler(opensDialog: OpensDialog | undefined): ((event: Event) => void) | undefined {
  if (!opensDialog) return undefined
  return (event) => {
    if (opensDialog === true || opensDialog()) event.preventDefault()
  }
}
