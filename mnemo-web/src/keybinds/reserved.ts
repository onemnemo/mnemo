import { eventKeyToken, isMac, logicalKeyToken, parseChord } from "./chord"

/**
 * The presses the app window claims before any binding sees them.
 *
 * The engine answers F5 and Ctrl+R with a reload and the print chord with a print
 * dialog, and PhotinoX has no switch for those accelerators, so a window-level guard
 * prevents their default and the keymap then declines the press as already answered.
 * An action bound to one of them can be set, reads as set, and never runs. This is the
 * one place that says which presses those are: the guard asks about a key event, and the
 * Keyboard page asks about a chord before storing it.
 *
 * A press is described by its raw modifier keys rather than by the platform's command
 * key. The accelerators belong to physical Ctrl and Cmd, not to whichever of the two a
 * chord spells as Primary, and Ctrl+P on macOS is caret movement, not printing.
 *
 * A key event is asked about by both of its readings, the physical key and the character
 * it typed, because engines match a letter accelerator by one on some keyboard layouts and
 * by the other on the rest. The guard and the recorder both ask the same way, so a press
 * the guard would swallow is never stored as a chord under its other name.
 */
export interface KeyPress {
  /** The key token a chord names: "R", "F5", "OemPeriod". */
  readonly key: string
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
  readonly shift: boolean
}

export function isReservedPress(press: KeyPress, apple: boolean): boolean {
  if (press.key === "F5") return true
  if (press.alt) return false
  if (!press.ctrl && !press.meta) return false
  if (press.key === "R") return true
  if (press.shift || press.key !== "P") return false
  return apple ? press.meta : press.ctrl
}

/** Whether the window keeps a key event for itself, by either of its readings. */
export function isReservedEvent(event: KeyboardEvent, apple: boolean): boolean {
  const modifiers = { ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey }
  const readings = [eventKeyToken(event), logicalKeyToken(event.key)]
  return readings.some((key) => key !== null && isReservedPress({ key, ...modifiers }, apple))
}

/**
 * Whether a canonical chord ("Primary+R", "Shift+F5") is one the window keeps for
 * itself. Off macOS, Primary and Ctrl are both the Ctrl key and Meta is never part of
 * a chord; on macOS, Primary is Cmd and Ctrl is Control. A stored chord names one
 * reading only, so this is for a row that already holds one; a press being recorded is
 * asked about as an event.
 */
export function isReservedChord(canonical: string, apple: boolean = isMac): boolean {
  const chord = parseChord(canonical)
  return isReservedPress(
    {
      key: chord.key,
      ctrl: apple ? chord.ctrl : chord.ctrl || chord.primary,
      meta: apple ? chord.primary : false,
      alt: chord.alt,
      shift: chord.shift,
    },
    apple,
  )
}
