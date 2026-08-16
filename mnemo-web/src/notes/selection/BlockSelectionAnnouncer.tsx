import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';

import { subscribeBlockSelection } from './block-selection-plugin';

/**
 * Speaks the block selection.
 *
 * One live region for every way the selection changes - marquee, grip click,
 * Ctrl+A, delete, Escape - so the keyboard commands announce without the
 * ProseMirror plugin needing to reach into the DOM. It reads the count off the
 * plugin state, so it says "n blocks selected" when a selection grows or shrinks
 * and "Selection cleared" once, when it goes back to empty; a change that leaves
 * the count the same is silent.
 */
export function BlockSelectionAnnouncer({ view }: { view: EditorView }) {
  const [message, setMessage] = useState('');
  const prevCount = useRef(0);

  useEffect(() => {
    const announce = (text: string) =>
      // Re-set even to the same text so a repeat still speaks; a trailing space
      // is a fresh string the screen reader treats as a new announcement.
      setMessage((prev) => (prev === text ? `${text} ` : text));

    return subscribeBlockSelection(view, (state) => {
      const count = state.selected.size;
      if (count === prevCount.current) return;
      if (count > 0) announce(`${String(count)} ${count === 1 ? 'block' : 'blocks'} selected`);
      else if (prevCount.current > 0) announce('Selection cleared');
      prevCount.current = count;
    });
  }, [view]);

  return (
    <div aria-live="polite" role="status" className="sr-only">
      {message}
    </div>
  );
}
