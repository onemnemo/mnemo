/**
 * A press that means one of two things depending on how long it lasts.
 *
 * Most of the dock is one control per thing it does, but a few tools own a set of sub-choices, and
 * putting each of those on the bar as its own control is how a toolbar ends up as wide as the
 * feature list. Holding the tool instead is the second meaning: the tap keeps arming the tool the
 * way it always did, and the hold opens that tool's own panel. The rule lives here rather than
 * inside a control so every tool that grows sub-choices later gets the same gesture instead of a
 * near-miss reimplementation of it.
 *
 * Nothing in here touches the DOM beyond the timer, so a control passes in whatever it has and the
 * gesture stays testable on its own.
 */

/**
 * How long a press has to last to count as a hold.
 *
 * A deliberate click lands well under half of this, so the tap path is never in danger, and a press
 * is already a stronger statement of intent than a hover, so it can sit below the tooltip's own
 * delay without feeling like the panel is jumping out at people.
 */
export const HOLD_MS = 350

export interface HoldCallbacks {
  onTap(): void
  onHold(): void
}

/**
 * Turns a press into a tap or a hold. Returns the handlers a control spreads onto itself, plus a
 * cancel for unmount.
 */
export function createHold(callbacks: HoldCallbacks): {
  onPointerDown(event: { pointerId: number }): void
  onPointerUp(): void
  onPointerLeave(): void
  onPointerCancel(): void
  cancel(): void
} {
  let timer: number | null = null
  let pointer: number | null = null
  let held = false

  /** The one exit path. Every branch below ends here, so no press can leave a timer behind. */
  const clear = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
    pointer = null
    held = false
  }

  return {
    onPointerDown(event) {
      // The pointer that opened the gesture is the one that decides it. A second finger landing on
      // the same control while the first is still down would otherwise restart the clock and turn a
      // hold that was nearly there back into nothing.
      if (pointer !== null && pointer !== event.pointerId) return

      clear()
      pointer = event.pointerId
      timer = window.setTimeout(() => {
        timer = null
        held = true
        callbacks.onHold()
      }, HOLD_MS)
    },

    onPointerUp() {
      if (pointer === null) return

      // A hold must not also count as a tap. By the time the button comes up the panel is already
      // open and that release is how a choice is picked out of it, so tapping as well would arm the
      // tool with the choice it held before, and the pick would then land on top of a state change
      // nobody asked for. One press, one outcome.
      const tapped = !held
      clear()
      if (tapped) callbacks.onTap()
    },

    onPointerLeave() {
      // Before the threshold this cancels outright: a press that slides off the control does
      // nothing, the same way a button swallows a click released past its edge. After it, the
      // gesture belongs to whatever the hold opened and the pointer is on its way there, so we drop
      // our own tracking and stay out of it, which is also what keeps that eventual release from
      // being read as a tap.
      clear()
    },

    // A pointer taken away by the system, which on touch is what a scroll gesture claiming the page
    // looks like. Without this the tracked pointer id is never released, and since touch ids keep
    // climbing, the guard above would turn every later press away and the control would be dead.
    onPointerCancel: clear,

    cancel: clear,
  }
}
