import { create } from 'zustand';

/**
 * Which callout has asked for the emoji picker, if any.
 *
 * Three places raise the same picker and none of them can own it. The glyph is
 * drawn by a NodeView, which is outside React entirely; the block menu row lives
 * in the gutter chrome and in the right-click menu, and a menu item cannot own a
 * layer that has to outlive the menu closing. So the ask travels through a store
 * and the picker is mounted once, beside the editor.
 *
 * A request names a block by position and sid, never by element. The picker
 * re-locates it against the live document, so a request whose block has since
 * moved still lands on the right one, and one for a block this view does not
 * hold resolves to nothing rather than to whatever sits at that position.
 */
export interface CalloutIconRequest {
  readonly pos: number;
  readonly sid: string;
}

interface CalloutIconState {
  request: CalloutIconRequest | null;
  open: (request: CalloutIconRequest) => void;
  close: () => void;
}

export const useCalloutIcon = create<CalloutIconState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/** The live request, for the callers outside React: the NodeView and the gutter. */
export function calloutIconRequest(): CalloutIconRequest | null {
  return useCalloutIcon.getState().request;
}

export function openCalloutIcon(request: CalloutIconRequest): void {
  useCalloutIcon.getState().open(request);
}

export function closeCalloutIcon(): void {
  useCalloutIcon.getState().close();
}
