import { Popover } from "radix-ui"
import { useState } from "react"
import type { ReactNode, RefObject } from "react"

import { EmojiPicker } from "./EmojiPicker"

/**
 * Anything the popover can be positioned against. A rect is all the positioner
 * reads; `contextElement` is what tells it which scroll containers to follow, and
 * without it a popover over a scrolling document is stranded by the first scroll.
 */
export interface EmojiPickerAnchor {
  getBoundingClientRect: () => DOMRect
  readonly contextElement?: Element
}

/**
 * The shared emoji picker in a popover around a trigger the caller supplies.
 *
 * {@link EmojiPickerButton} is the same picker for the common case, where the icon
 * itself is the control. This is for the callers that already own their trigger, or
 * that raise the picker from somewhere else entirely (a menu item, a block's hover
 * chrome), which needs the open state to be theirs rather than private.
 *
 * A caller whose trigger is not a React element at all passes `anchor` instead of
 * `children`: the popover then positions against that rect and there is no trigger
 * for the layer to hand focus back to, so such a caller also owns `onCloseAutoFocus`.
 */
export function EmojiPickerPopover({
  value,
  context,
  label,
  onChange,
  children,
  anchor,
  open: openProp,
  onOpenChange,
  onCloseAutoFocus,
}: {
  value: string | null
  /** What the icon is for, usually a name. Only reorders the picker's sections. */
  context?: string
  /** Names the popover for assistive tech; the trigger carries its own label. */
  label: string
  /** Null clears the icon. */
  onChange: (next: string | null) => void
  children?: ReactNode
  /** Position against this instead of a trigger element, for a control React does not own. */
  anchor?: RefObject<EmojiPickerAnchor>
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Where focus goes on close. Required alongside `anchor`, or it lands on the body. */
  onCloseAutoFocus?: (event: Event) => void
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
      {anchor ? (
        <Popover.Anchor virtualRef={anchor} />
      ) : (
        <Popover.Trigger asChild>{children}</Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={label}
          onCloseAutoFocus={onCloseAutoFocus}
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
