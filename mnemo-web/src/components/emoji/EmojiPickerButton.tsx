import { Popover } from "radix-ui"
import { useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

import { EmojiPicker } from "./EmojiPicker"

/**
 * The icon as a button: shows what is set, opens the picker to change it.
 *
 * The icon is the affordance for changing it, with no separate control, and the
 * empty state is just as clickable as a set one.
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

  const commit = (char: string | null) => {
    onChange(char)
    setOpen(false)
  }

  const glyph = glyphSize ?? Math.round(size * 0.78)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
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
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="animate-pop-in z-[145] rounded-xl bg-canvas shadow-pop focus:outline-none"
        >
          <EmojiPicker value={value} context={context} onSelect={commit} onClear={() => commit(null)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
