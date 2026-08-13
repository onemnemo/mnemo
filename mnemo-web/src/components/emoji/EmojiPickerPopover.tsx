import { Popover } from "radix-ui"
import { useState } from "react"
import type { ReactNode } from "react"

import { EmojiPicker } from "./EmojiPicker"

/**
 * The shared emoji picker in a popover around a trigger the caller supplies.
 *
 * {@link EmojiPickerButton} is the same picker for the common case, where the icon
 * itself is the control. This is for the callers that already own their trigger, or
 * that raise the picker from somewhere else entirely (a menu item, a block's hover
 * chrome), which needs the open state to be theirs rather than private.
 */
export function EmojiPickerPopover({
  value,
  context,
  label,
  onChange,
  children,
  open: openProp,
  onOpenChange,
}: {
  value: string | null
  /** What the icon is for, usually a name. Only reorders the picker's sections. */
  context?: string
  /** Names the popover for assistive tech; the trigger carries its own label. */
  label: string
  /** Null clears the icon. */
  onChange: (next: string | null) => void
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const commit = (next: string | null) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          className="animate-pop-in z-[145] rounded-xl bg-canvas shadow-pop focus:outline-none"
        >
          <EmojiPicker
            value={value}
            context={context}
            onSelect={(char) => commit(char)}
            onClear={() => commit(null)}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
