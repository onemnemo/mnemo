import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

import { EmojiPickerPopover } from "./EmojiPickerPopover"

/**
 * The icon as a button: shows what is set, opens the picker to change it.
 *
 * The icon is the affordance for changing it, with no separate control, and the
 * empty state is just as clickable as a set one.
 *
 * The popover itself is {@link EmojiPickerPopover}, which owns that wrapper for
 * every caller; this adds only the trigger. The open state is still held here
 * because the button paints itself as pressed while the picker is up.
 *
 * The emoji is stored and rendered as its own Unicode value, so what sits here is
 * text the OS draws with its emoji font, not an image the app has to ship or a
 * span of markup it has to sanitise on the way back out.
 */
export function EmojiPickerButton({
  value,
  context,
  onChange,
  fallback,
  label,
  size = 32,
  glyphSize,
  className,
}: {
  value: string | null
  /** What the icon is for, usually a name. Only reorders the picker's sections. */
  context?: string
  /** Null clears the icon back to the fallback mark. */
  onChange: (char: string | null) => void
  fallback: IconName
  label: string
  /** Box size in px. The glyph scales with it. */
  size?: number
  glyphSize?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)

  const glyph = glyphSize ?? Math.round(size * 0.78)

  return (
    <EmojiPickerPopover
      value={value}
      context={context}
      label={label}
      onChange={onChange}
      open={open}
      onOpenChange={setOpen}
    >
      <button
        type="button"
        title={label}
        aria-label={label}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-frame-hover",
          open && "bg-frame-hover",
          className,
        )}
        style={{ width: size, height: size, transitionDuration: "var(--duration-fast)" }}
      >
        {value ? (
          <span aria-hidden style={{ fontSize: glyph, lineHeight: 1 }}>
            {value}
          </span>
        ) : (
          <AppIcon name={fallback} size={glyph} strokeWidth={1.5} className="text-ink-icon" />
        )}
      </button>
    </EmojiPickerPopover>
  )
}
