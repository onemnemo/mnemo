/**
 * Which presses mean "move the map" rather than "change what is selected".
 *
 * The runtime pans on these and the selection controller stands aside for them. Kept in one place
 * because two lists agreeing by hand drift into a press that both answer, which reads as a marquee
 * that also slides the canvas out from under itself.
 */

import { isMac } from "@/keybinds/chord"

/**
 * The platform's own "and this one too" modifier, which over empty canvas pans instead.
 *
 * Ctrl is the secondary click on a Mac, so the key there is Cmd. That leaves the modifier meaning
 * the same thing it means everywhere else in the app, and leaves the Mac's Ctrl free to go on
 * opening a menu.
 */
export function panModifier(event: { readonly ctrlKey: boolean; readonly metaKey: boolean }): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}

/** Whether a press landed on a node rather than on the canvas behind it. */
export function onNode(target: EventTarget | null): boolean {
  return (target as HTMLElement | null)?.closest?.(".mm-node") != null
}
