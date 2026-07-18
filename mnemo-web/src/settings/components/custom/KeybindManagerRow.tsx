import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"
import { useKeybindManagerStore } from "@/keybinds/manager/store"

import { SettingRowShell } from "../SettingRowShell"

/** Opens the keybind manager overlay. */
export function KeybindManagerRow({
  title,
  description,
  divider,
}: {
  title: string
  description?: string
  divider: boolean
}) {
  const t = useT()
  const open = useKeybindManagerStore((s) => s.open)

  return (
    <SettingRowShell title={title} description={description} divider={divider}>
      <Button variant="outline" size="sm" onClick={open}>
        {t("Settings", "OpenManager")}
      </Button>
    </SettingRowShell>
  )
}
