/**
 * Whether a modal dialog is currently on screen.
 *
 * Shortcuts bound on the window still fire while a focus-trapped dialog has the reader's
 * attention: Space would grade a card that is no longer visible, and the study screens would
 * leave a session that the reader was only being asked about. Every window-level handler checks
 * this first.
 *
 * Asking the DOM rather than keeping a register of stores means a dialog is covered the day it
 * is added - which is how the study screens came to miss the confirm host and the settings
 * dialog. Every dialog in the app is a Radix one, and Radix stamps its content with both of
 * these attributes for as long as it is open.
 */
export function isModalOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"]') !== null
}
