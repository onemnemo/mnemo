import type { ReactNode } from "react"
import { ContextMenu as RadixContextMenu } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"

import { cn } from "@/lib/utils"

import { MenuItemBody } from "./menu"
import { CONTENT_CLASS, ITEM_CLASS, itemClass } from "./menu-styles"

// The right-click twin of ./menu. Shares its styling so a context menu and a
// flyout are indistinguishable, which is what the desktop does - the card row's
// actions live on right-click there, with no per-row button.

export const ContextMenu = RadixContextMenu.Root
export const ContextMenuTrigger = RadixContextMenu.Trigger

export function ContextMenuContent({ children }: { children: ReactNode }) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content className={CONTENT_CLASS}>{children}</RadixContextMenu.Content>
    </RadixContextMenu.Portal>
  )
}

export function ContextMenuItem({
  children,
  onSelect,
  icon,
  hint,
  danger,
  disabled,
}: {
  children: ReactNode
  onSelect?: () => void
  icon?: IconName
  hint?: string
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <RadixContextMenu.Item disabled={disabled} onSelect={onSelect} className={itemClass(danger)}>
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
}: {
  children: ReactNode
  label: string
  icon?: IconName
}) {
  return (
    <RadixContextMenu.Sub>
      <RadixContextMenu.SubTrigger
        className={cn(
          ITEM_CLASS,
          "text-text-secondary data-[highlighted]:bg-surface-subtle data-[highlighted]:text-foreground data-[state=open]:bg-surface-subtle",
        )}
      >
        <MenuItemBody icon={icon} trailing={<AppIcon name="common/chevron-right" size={12} />}>
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
