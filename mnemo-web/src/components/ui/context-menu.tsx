import type { ReactNode } from "react"
import { ContextMenu as RadixContextMenu } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"

import { cn } from "@/lib/utils"

import { MenuItemBody } from "./menu"
import { closeFocusHandler, type OpensDialog } from "./menu-focus"
import { CONTENT_CLASS, ITEM_CLASS, itemClass } from "./menu-styles"

// The right-click twin of ./menu. Shares its styling so a context menu and a
// flyout are indistinguishable, which is what the desktop does - the card row's
// actions live on right-click there, with no per-row button.

export const ContextMenu = RadixContextMenu.Root
export const ContextMenuTrigger = RadixContextMenu.Trigger

export function ContextMenuContent({
  children,
  opensDialog,
}: {
  children: ReactNode
  /** Set on a menu whose items put a caret on screen, a dialog or an inline editor. */
  opensDialog?: OpensDialog
}) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content className={CONTENT_CLASS} onCloseAutoFocus={closeFocusHandler(opensDialog)}>
        {children}
      </RadixContextMenu.Content>
    </RadixContextMenu.Portal>
  )
}

export function ContextMenuItem({
  children,
  onSelect,
  icon,
  hint,
  danger,
  emphasis,
  disabled,
}: {
  children: ReactNode
  onSelect?: () => void
  icon?: IconName
  hint?: string
  danger?: boolean
  /** Draws the item as the suggested action (the deck menu pre-highlights one). */
  emphasis?: boolean
  disabled?: boolean
}) {
  return (
    <RadixContextMenu.Item disabled={disabled} onSelect={onSelect} className={itemClass(danger, emphasis)}>
      <MenuItemBody icon={icon} hint={hint}>
        {children}
      </MenuItemBody>
    </RadixContextMenu.Item>
  )
}

export function ContextMenuSubMenu({
  children,
  label,
  icon,
  hint,
  emphasis,
}: {
  children: ReactNode
  label: string
  icon?: IconName
  hint?: string
  emphasis?: boolean
}) {
  return (
    <RadixContextMenu.Sub>
      <RadixContextMenu.SubTrigger
        className={cn(
          ITEM_CLASS,
          "text-text-secondary data-[highlighted]:bg-surface-subtle data-[highlighted]:text-foreground data-[state=open]:bg-surface-subtle",
          emphasis && "font-medium text-foreground",
        )}
      >
        <MenuItemBody icon={icon} hint={hint} trailing={<AppIcon name="common/chevron-right" size={12} />}>
          {label}
        </MenuItemBody>
      </RadixContextMenu.SubTrigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.SubContent sideOffset={2} alignOffset={-4} className={CONTENT_CLASS}>
          {children}
        </RadixContextMenu.SubContent>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Sub>
  )
}

export function ContextMenuSeparator() {
  return <RadixContextMenu.Separator className="my-1 h-px bg-divider-subtle" />
}

/** A non-interactive grouping caption, e.g. "PRACTICE / NO SCHEDULE". */
export function ContextMenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <RadixContextMenu.Label className="px-2 pt-2 pb-1 text-caption font-semibold tracking-wide text-text-faded uppercase">
      {children}
    </RadixContextMenu.Label>
  )
}
