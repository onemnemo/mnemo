import type { ReactNode } from "react"
import { DropdownMenu } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

import { CONTENT_CLASS, ITEM_CLASS, itemClass } from "./menu-styles"

// The app's flyout menu, styled once. Mirrors the desktop MenuFlyout: an icon
// column, an optional right-aligned gesture hint, danger and section-header
// variants, and nested submenus.

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger
export const MenuSub = DropdownMenu.Sub


export function MenuContent({
  children,
  align = "start",
  className,
}: {
  children: ReactNode
  align?: "start" | "center" | "end"
  className?: string
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content align={align} sideOffset={4} className={cn(CONTENT_CLASS, className)}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  )
}

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  icon?: IconName
  /** Right-aligned shortcut or count, as the desktop menus show. */
  hint?: string
  danger?: boolean
  /** Draws the item as the suggested action (the deck menu pre-highlights one). */
  emphasis?: boolean
  disabled?: boolean
}

export function MenuItem({ children, onSelect, icon, hint, danger, emphasis, disabled }: MenuItemProps) {
  return (
    <DropdownMenu.Item disabled={disabled} onSelect={onSelect} className={itemClass(danger, emphasis)}>
      <MenuItemBody icon={icon} hint={hint}>
        {children}
      </MenuItemBody>
    </DropdownMenu.Item>
  )
}

/** A submenu whose trigger row looks and reads like a normal item. */
export function MenuSubMenu({
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
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className={cn(
          ITEM_CLASS,
          "text-text-secondary data-[highlighted]:bg-surface-subtle data-[highlighted]:text-foreground data-[state=open]:bg-surface-subtle",
          emphasis && "font-medium text-foreground",
        )}
      >
        <MenuItemBody icon={icon} hint={hint} trailing={<AppIcon name="common/chevron-right" size={12} />}>
          {label}
        </MenuItemBody>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={2} alignOffset={-4} className={CONTENT_CLASS}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

/**
 * A group of mutually exclusive choices, e.g. a width. The check sits in the same
 * icon column a normal item's glyph uses, so a radio group and a plain list of
 * items keep one text baseline instead of stepping in and out.
 */
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </DropdownMenu.RadioGroup>
  )
}

export function MenuRadioItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem value={value} className={itemClass()}>
      <span className="grid size-[14px] shrink-0 place-items-center">
        <DropdownMenu.ItemIndicator>
          <AppIcon name="common/check" size={13} className="text-text-secondary" />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="flex-1 truncate">{children}</span>
    </DropdownMenu.RadioItem>
  )
}

export function MenuItemBody({
  children,
  icon,
  hint,
  trailing,
}: {
  children: ReactNode
  icon?: IconName
  hint?: string
  trailing?: ReactNode
}) {
  return (
    <>
      {icon ? <AppIcon name={icon} size={14} className="text-text-faded" /> : null}
      <span className="flex-1 truncate">{children}</span>
      {hint ? <span className="text-caption text-text-faded tabular-nums">{hint}</span> : null}
      {trailing}
    </>
  )
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-divider-subtle" />
}

/** A non-interactive grouping caption, e.g. "PRACTICE · NO SCHEDULE". */
export function MenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 pt-2 pb-1 text-caption font-semibold tracking-wide text-text-faded uppercase">
      {children}
    </DropdownMenu.Label>
  )
}
