/**
 * The listener set a table drag runs on, and the two ways out of one.
 *
 * All three of the table's drags preview on the table itself and put the
 * pre-drag shape back before committing the released one, so a gesture that
 * ends any other way has to run that rollback or the table is left in a shape
 * nobody asked for and two window listeners outlive it. `abort` is that
 * rollback: it answers a lost pointer (the window taking the gesture, a
 * cancelled touch) and Escape, which is otherwise the one key a drag in flight
 * does not respond to.
 *
 * Escape is taken in the capture phase and stopped there, ahead of the table's
 * own Escape handler, so ending a drag does not also drop the selection the
 * press that started it made.
 */
export function trackDrag(handlers: {
  move: (event: PointerEvent) => void;
  /** The pointer was released: commit whatever the drag arrived at. */
  end: () => void;
  /** The gesture was lost or cancelled: put the pre-drag shape back. */
  abort: () => void;
}): void {
  function stop(): void {
    window.removeEventListener('pointermove', handlers.move);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onAbort);
    window.removeEventListener('keydown', onKey, true);
  }

  function onUp(): void {
    stop();
    handlers.end();
  }

  function onAbort(): void {
    stop();
    handlers.abort();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onAbort();
  }

  window.addEventListener('pointermove', handlers.move);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onAbort);
  window.addEventListener('keydown', onKey, true);
}
