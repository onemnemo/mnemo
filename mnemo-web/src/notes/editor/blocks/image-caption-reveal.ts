/**
 * Whether one image is showing its caption line, offered to the surfaces that are not inside it.
 *
 * The caption is mandatory in the schema and never removed, so "has a caption" is presentation
 * rather than content, and it belongs to the view that draws the picture. The right-click menu is
 * built at the React root and has no handle on that view, so the view lends one out here, keyed by
 * the block's sid and by the view it lives in: two panes can show the same note, and each has its
 * own idea of which captions are open.
 */

import type { EditorView } from 'prosemirror-view';

export interface CaptionReveal {
  /** Whether the line is showing right now, not whether it holds text. */
  visible(): boolean;
  /** Flips it, and puts the caret in the line when it comes on. */
  toggle(): void;
}

const byView = new WeakMap<EditorView, Map<string, CaptionReveal>>();

/**
 * Lends this block's caption switch out for as long as its view is up. Returns the withdrawal,
 * identity checked so a rebuilt view cannot withdraw its replacement's entry.
 */
export function registerCaptionReveal(view: EditorView, sid: string, reveal: CaptionReveal): () => void {
  if (sid.length === 0) return () => undefined;
  const map = byView.get(view) ?? new Map<string, CaptionReveal>();
  map.set(sid, reveal);
  byView.set(view, map);
  return () => {
    if (map.get(sid) === reveal) map.delete(sid);
  };
}

/** The switch for one image block, or null where no view of it is up. */
export function captionRevealFor(view: EditorView, sid: string): CaptionReveal | null {
  return byView.get(view)?.get(sid) ?? null;
}
