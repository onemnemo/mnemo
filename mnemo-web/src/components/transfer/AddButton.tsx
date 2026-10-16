import { AppIcon } from "@/components/icon/AppIcon"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { MODAL_MENU_CLASS } from "@/components/ui/modal-menu"
import { useT } from "@/i18n/useT"

const ADD_BUTTON =
  "inline-flex h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-text-secondary transition-colors hover:bg-frame-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-45 data-[state=open]:bg-frame-active"

/** Footer Add button. It opens a files or folder menu when folders are on and is a plain file button otherwise. */
export function AddButton({
  disabled,
  folders,
  onFiles,
  onFolder,
}: {
  disabled: boolean
  folders: boolean
  onFiles: () => void
  onFolder: () => void
}) {
  const t = useT()
  const label = t("Common", "TransferAdd")
  const body = (
    <>
      <AppIcon name="plus" size={14} />
      {label}
    </>
  )

  if (!folders) {
    return (
      <button type="button" disabled={disabled} onClick={onFiles} className={ADD_BUTTON}>
        {body}
      </button>
    )
  }

  return (
    <Menu>
      <MenuTrigger asChild disabled={disabled}>
        <button type="button" className={ADD_BUTTON}>
          {body}
        </button>
      </MenuTrigger>
      <MenuContent className={MODAL_MENU_CLASS} side="top">
        <MenuItem icon="common/file-text" onSelect={onFiles}>
          {t("Common", "TransferAddFiles")}
        </MenuItem>
        <MenuItem icon="common/folder" onSelect={onFolder}>
          {t("Common", "TransferAddFolder")}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
