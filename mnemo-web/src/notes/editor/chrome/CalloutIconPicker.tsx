import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';

import { EmojiPickerPopover, type EmojiPickerAnchor } from '@/components/emoji/EmojiPickerPopover';
import { useT } from '@/i18n/useT';

import type { BlockRegistry } from '../registry/build';
import { locateBlock } from './block-commands';
import { isCalloutNode, setCalloutEmoji } from './callout-icon';
import { useCalloutIcon } from './callout-icon-request';

/**
 * The emoji picker one note's callouts share, mounted once beside the editor.
 *
 * It is not part of the gutter chrome and not part of the NodeView. The chrome
 * comes and goes with the pointer, the NodeView is outside React, and the block
 * menu that also raises this picker is gone by the time it opens, so the one
 * place that can hold it is here.
 *
 * There is no trigger element: the popover is positioned against the glyph's own
 * rect through a virtual anchor, which is what puts it on the glyph the reader
 * pressed rather than on whatever raised it. The anchor reports the callout's
 * element when the glyph is hidden, which is the glyph-less callout the block
 * menu is the only way into.
 */
export function CalloutIconPicker({ view, registry }: { view: EditorView; registry: BlockRegistry }) {
  const t = useT();
  const request = useCalloutIcon((state) => state.request);
  const close = useCalloutIcon((state) => state.close);

  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState<string | null>(null);

  // The element the popover measures, re-read on every open. One stable object,
  // because the positioner treats a new one as a different anchor and re-measures
  // from scratch.
  const anchored = useRef<HTMLElement | null>(null);
  const anchor = useRef<EmojiPickerAnchor>({
    get contextElement() {
      return anchored.current ?? undefined;
    },
    getBoundingClientRect: () => anchored.current?.getBoundingClientRect() ?? new DOMRect(),
  });

  useEffect(() => {
    if (!request) {
      setOpen(false);
      anchored.current = null;
      return;
    }
    // Re-located against the live document: the position the request carries may
    // predate an invariant repair, and a request for a block this view does not
    // hold has to resolve to nothing rather than to whatever sits there.
    const located = locateBlock(view.state, registry, request.pos, request.sid);
    if (!located || !isCalloutNode(located.node)) {
      close();
      return;
    }
    const dom = view.nodeDOM(located.pos);
    const block = dom instanceof HTMLElement ? dom : null;
    const glyph = block?.querySelector('.notes-callout-glyph');
    anchored.current = glyph instanceof HTMLElement && !glyph.hidden ? glyph : block;
    setEmoji(String(located.node.attrs.emoji ?? '') || null);

    // Opened a tick late, and by a timer rather than a frame: a request from the
    // block menu would otherwise open into that menu's own teardown and be
    // dismissed along with it, and frames are suspended while the window is not
    // compositing, which would leave the picker never opening at all.
    const timer = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(timer);
  }, [request, view, registry, close]);

  return (
    <EmojiPickerPopover
      value={emoji}
      label={t('NotesEditor', 'CalloutIcon')}
      anchor={anchor}
      open={open && request !== null}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        close();
      }}
      // With no trigger there is nothing for the layer to restore focus to, so
      // it would land on the body and drop the reader out of the document.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        view.focus();
      }}
      onChange={(next) => {
        if (request) setCalloutEmoji(view, registry, request, next ?? '');
      }}
    />
  );
}
