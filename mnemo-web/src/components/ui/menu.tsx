import type { ComponentProps, ReactNode } from "react"
import { DropdownMenu } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

import { closeFocusHandler, type OpensDialog } from "./menu-focus"
import { CONTENT_CLASS, ITEM_CLASS, itemClass } from "./menu-styles"

// The app's flyout menu, styled once. Mirrors the desktop MenuFlyout: an icon
// column, an optional right-aligned gesture hint, danger and section-header
// variants, and nested submenus.

/** Not modal, for the reasons ./context-menu states; pass `modal` to override. */
export function Menu({ modal = false, ...props }: ComponentProps<typeof DropdownMenu.Root>) {
  return <DropdownMenu.Root modal={modal} {...props} />
}

export const MenuTrigger = DropdownMenu.Trigger
export const MenuSub = DropdownMenu.Sub


export function MenuContent({
  children,
  align = "start",
  className,
  opensDialog,
}: {
  children: ReactNode
  align?: "start" | "center" | "end"
  className?: string
  /** Set on a menu whose items put a caret on screen, a dialog or an inline editor. */
  opensDialog?: OpensDialog
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={4}
        className={cn(CONTENT_CLASS, className)}
        onCloseAutoFocus={closeFocusHandler(opensDialog)}
      >
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

/**
 * A row that reports a state as well as running a verb.
 *
 * The tick sits after the label, not before it. The column in front belongs to
 * the row's own glyph, which says what the row is *about*, and a colour swatch
 * that vanished the moment its colour was the chosen one would be hiding the
 * answer at the only moment it matters. Trailing also puts the tick in the same
 * place a submenu puts its chevron, so a menu mixing toggles, submenus and plain
 * verbs keeps one left edge and one right edge instead of four.
 */
export function MenuCheckItem({
  checked,
  onSelect,
  icon,
  leading,
  hint,
  disabled,
  children,
}: {
  checked: boolean
  onSelect?: () => void
  icon?: IconName
  /** Drawn in the icon column instead of a glyph, e.g. a colour swatch. */
  leading?: ReactNode
  hint?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      disabled={disabled}
      onSelect={onSelect}
      className={itemClass()}
    >
      <MenuItemBody
        icon={icon}
        leading={leading}
        hint={hint}
        // The slot is reserved whether or not it is ticked, so a row does not
        // shift sideways as it is toggled.
        trailing={
          <span className="grid size-[14px] shrink-0 place-items-center">
            <DropdownMenu.ItemIndicator>
              <AppIcon name="common/check" size={13} className="text-text-secondary" />
            </DropdownMenu.ItemIndicator>
          </span>
        }
      >
        {children}
      </MenuItemBody>
    </DropdownMenu.CheckboxItem>
  )
}

export function MenuItemBody({
  children,
  icon,
  leading,
  hint,
  trailing,
}: {
  children: ReactNode
  icon?: IconName
  /** Takes the icon column when the row's mark is not a glyph. */
  leading?: ReactNode
  hint?: string
  trailing?: ReactNode
}) {
  return (
    <>
      {leading ?? (icon ? <AppIcon name={icon} size={14} className="text-text-faded" /> : null)}
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
