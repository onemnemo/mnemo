import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

import { AppIcon } from '@/components/icon/AppIcon';

import type { Box } from './reorder';
import type { TreeDrag } from './useNoteTreeDrag';

/**
 * Everything a tree drag paints over the page: the pill under the cursor, the
 * accent line where a row would land, and the block that lights up when a note
 * or folder would nest. Portalled to the body so the pane's own overflow clip
 * cannot cut it off, and inert so it never takes the pointer.
 */

function boxStyle(box: Box) {
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

export function TreeDragLayer({ handle, target, ghostRef, placeGhost }: TreeDrag) {
  useLayoutEffect(() => {
    if (handle) placeGhost();
  });

  if (!handle) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[999]">
      {target?.highlight ? (
        <div
          className="absolute rounded-md border"
          style={{
            ...boxStyle(target.highlight),
            borderColor: 'var(--accent)',
            background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
          }}
        />
      ) : null}

      {target?.line ? (
        <div className="absolute rounded-full" style={{ ...boxStyle(target.line), background: 'var(--accent)' }} />
      ) : null}

      <div
        ref={ghostRef}
        className="absolute left-0 top-0 flex max-w-[240px] items-center gap-2 rounded-lg border border-line bg-popover px-3 py-1.5 shadow-elevation-4"
      >
        <AppIcon
          name={handle.kind === 'folder' ? 'common/folder' : 'common/file-text'}
          size={13}
          className="shrink-0 text-text-faded"
        />
        <span className="min-w-0 truncate text-body-extra-small font-medium text-text-primary">{handle.label}</span>
      </div>
    </div>,
    document.body,
  );
}
