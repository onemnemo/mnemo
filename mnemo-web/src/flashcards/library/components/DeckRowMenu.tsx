import type { ReactNode } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSectionLabel, MenuSeparator, MenuSubMenu, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import type { DeckMenuEntry } from "./deck-row-menu-items"

/** Renders the deck's verb list with the flyout family. */
function renderDeckMenu(entries: readonly DeckMenuEntry[]): ReactNode {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "separator":
        return <MenuSeparator key={entry.id} />
      case "section":
        return <MenuSectionLabel key={entry.id}>{entry.label}</MenuSectionLabel>
      case "submenu":
        return (
          <MenuSubMenu key={entry.id} label={entry.label} icon={entry.icon} hint={entry.hint} emphasis={entry.emphasis}>
            {renderDeckMenu(entry.items)}
          </MenuSubMenu>
        )
      case "item":
        return (
          <MenuItem
            key={entry.id}
            icon={entry.icon}
            hint={entry.hint}
            emphasis={entry.emphasis}
            danger={entry.danger}
            disabled={entry.disabled}
            onSelect={entry.run}
          >
            {entry.label}
          </MenuItem>
        )
    }
  })
}

/** The per-deck flyout, behind the row's overflow button. */
export function DeckRowMenu({ entries }: { entries: readonly DeckMenuEntry[] }) {
  const t = useT()
  const label = t("Flashcards", "DeckMenu")

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(event) => event.stopPropagation()}
          className="grid size-7 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover/deck:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 hover:bg-frame-active hover:text-ink"
        >
          <AppIcon name="common/ellipsis" size={15} />
        </button>
      </MenuTrigger>

      <MenuContent align="end">{renderDeckMenu(entries)}</MenuContent>
    </Menu>
  )
}
