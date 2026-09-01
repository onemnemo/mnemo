/**
 * The picture a press just landed on, handed to the right-click menu.
 *
 * The menu decides what to offer from a pointerdown snapshot at the React root, and it resolves
 * the block from the pointer's coordinates. Over an image that resolution can miss: the media is
 * this view's own opaque DOM, `posAtCoords` has no editable position to answer with there, and the
 * fallback names the caret's block instead, so a right-click on a selected picture offered another
 * block's generic rows. The press itself is the one thing that knows what was pressed, so it says
 * so here on the way past.
 *
 * One slot, taken and cleared: a press that opens no menu must not decide a later one, and a
 * snapshot must never see a press older than itself. The block is named by position *and* sid, the
 * same pair the callout picker travels under, so the reader can re-locate it and refuse a slot
 * whose block is no longer there.
 */

export interface ImagePress {
  readonly pos: number;
  readonly sid: string;
}

let pending: ImagePress | null = null;

/** Records the press. Only a press on a picture's media calls this. */
export function recordImagePress(press: ImagePress): void {
  pending = press;
}

/** The recorded press, cleared by the reading, so it can never answer twice. */
export function takeImagePress(): ImagePress | null {
  const press = pending;
  pending = null;
  return press;
}
