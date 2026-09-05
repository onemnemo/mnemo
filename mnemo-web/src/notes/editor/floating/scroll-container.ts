/**
 * The box a piece of floating chrome has to stay inside, and the test for
 * whether the thing it points at is still in view.
 *
 * Every layer anchored to a position in the note has the same problem: the
 * document scrolls inside a container that is smaller than the window, so an
 * anchor can leave the note while still being a perfectly valid viewport
 * coordinate. Placement alone cannot tell, since a clamp keeps an off-screen
 * anchor's chrome pinned to a window edge, pointing at nothing.
 */

/** The nearest scrollable ancestor, or null when nothing above it scrolls. */
export function scrollContainerOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * Whether `anchor` still overlaps `container`, both in viewport coordinates.
 *
 * A null container is the note filling the window, which nothing can scroll
 * out of, so it answers true rather than falling back to a window-sized box
 * that would need its own measurement.
 */
export function anchorInContainer(anchor: Box, container: HTMLElement | null): boolean {
  if (!container) return true;
  const box = container.getBoundingClientRect();
  return (
    anchor.bottom > box.top &&
    anchor.top < box.bottom &&
    anchor.right > box.left &&
    anchor.left < box.right
  );
}
