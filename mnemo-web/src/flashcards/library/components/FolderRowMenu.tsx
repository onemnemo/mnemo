import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { useT } from "@/i18n/useT"

import type { FolderMenuEntry } from "./folder-row-menu-items"

/** Renders the folder's verb list with the flyout family. */
function renderFolderMenu(entries: readonly FolderMenuEntry[]) {
  return entries.map((entry) => {
    switch (entry.kind) {
      case "separator":
        return <MenuSeparator key={entry.id} />
      case "item":
        return (
          <MenuItem
            key={entry.id}
            icon={entry.icon}
            emphasis={entry.emphasis}
            danger={entry.danger}
            onSelect={entry.run}
          >
            {entry.label}
          </MenuItem>
        )
    }
  })
}

/**
 * The per-folder flyout, behind the row's overflow button.
 *
 * `opensEditor` answers whether the verb just chosen was rename, which raises the inline
 * editor and needs the menu to leave focus alone on the way out or the field is blurred,
 * and committed, the instant it appears.
 */
export function FolderRowMenu({
  entries,
  opensEditor,
}: {
  entries: readonly FolderMenuEntry[]
  opensEditor: () => boolean
}) {
  const t = useT()
  const label = t("Flashcards", "FolderActions")

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(event) => event.stopPropagation()}
          // aria-expanded holds it open: the flyout takes pointer events off the body and focus
          // into its portal, so neither hover nor focus-within matches its own row any more.
          className="grid size-7 place-items-center rounded-md text-ink-3 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 hover:bg-frame-active hover:text-ink"
        >
          <AppIcon name="common/ellipsis" size={15} />
        </button>
      </MenuTrigger>

      <MenuContent align="end" opensDialog={opensEditor}>
        {renderFolderMenu(entries)}
      </MenuContent>
    </Menu>
  )
}
