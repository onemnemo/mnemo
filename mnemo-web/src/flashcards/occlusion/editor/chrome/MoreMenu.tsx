import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { IconButton } from "@/components/ui/icon-button"
import { useT } from "@/i18n/useT"

/** The header's More menu, which holds the actions on the image itself. */
export function MoreMenu({ onReplaceImage }: { onReplaceImage: () => void }) {
  const t = useT()

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton icon="ellipsis" iconSize={16} label={t("Flashcards", "OcclusionMore")} />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon="image" onSelect={onReplaceImage}>
          {t("Flashcards", "OcclusionReplaceImage")}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
