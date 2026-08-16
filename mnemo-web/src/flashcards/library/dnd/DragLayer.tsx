import { useLayoutEffect } from "react"
import { createPortal } from "react-dom"

import { AppIcon } from "@/components/icon/AppIcon"

import type { Box } from "./model"
import type { LibraryDrag } from "./useLibraryDrag"

// Everything a drag paints over the page: the pill under the cursor, the accent line where a
// folder would land, and the block that lights up when it would nest. Portalled to the body so
// the tree card's own overflow clip cannot cut it off, and inert so it never takes the pointer.

function boxStyle(box: Box) {
  return { top: box.top, left: box.left, width: box.width, height: box.height }
}

export function DragLayer({ handle, target, ghostRef, placeGhost }: LibraryDrag) {
  // The ghost's offset depends on its own measured size, so it can only be pinned once it is
  // on the page. Without this it paints one frame in the top-left corner before the next move.
  useLayoutEffect(() => {
    if (handle) placeGhost()
  })

  if (!handle) return null

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[999]">
      {target?.highlight ? (
        <div
          className="absolute rounded-md border"
          style={{
            ...boxStyle(target.highlight),
            borderColor: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 16%, transparent)",
          }}
        />
      ) : null}

      {target?.line ? (
        <div
          className="absolute rounded-full"
          style={{ ...boxStyle(target.line), background: "var(--accent)" }}
        />
      ) : null}

      <div
        ref={ghostRef}
        className="absolute left-0 top-0 flex max-w-[280px] items-center gap-2 rounded-lg border border-line bg-popover px-3 py-2 shadow-elevation-4"
      >
        <AppIcon name="common/grip-vertical" size={14} className="shrink-0 text-text-faded" />
        {/* min-w-0 so a long deck name actually truncates instead of pushing the pill wider. */}
        <span className="min-w-0 truncate text-body-extra-small font-medium text-text-primary">{handle.label}</span>
        <span className="shrink-0 text-caption text-text-faded">{handle.subtitle}</span>
      </div>
    </div>,
    document.body,
  )
}
